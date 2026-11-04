/**
 * Generates one Lua chunk per placement: a self-contained file the loader runs, with the target
 * state and curve baked in. A chunk starts from the state its predecessor hands over (position
 * and velocity), so a retarget mid-flight continues rather than snapping; without a predecessor
 * it starts from `from` when given, else from the item as it is in OBS.
 */
import { sampleEase, springPhysics, type Transition } from "./index.js";

/** A scene item's visual state: centre, size, rotation and opacity. */
export interface Visual {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly rot: number;
  readonly op: number;
}

export interface ChunkSpec {
  readonly sceneName: string;
  readonly sceneItemId: number;
  /** The input whose `vignette/opacity` filter carries opacity, or undefined to leave it alone. */
  readonly opacityInput?: string;
  readonly label: string;
  /** A baked start state; omitted, the chunk inherits its predecessor's or reads the item. */
  readonly from?: Visual;
  readonly to: Visual;
  readonly transition: Transition;
  /** Disable the item once settled: an exit. */
  readonly hideAtEnd?: boolean;
}

const num = (v: number): string => String(Number(v.toFixed(5)));
const visual = (v: Visual | undefined): string =>
  v === undefined
    ? "nil"
    : `{ cx = ${num(v.cx)}, cy = ${num(v.cy)}, w = ${num(v.w)}, h = ${num(v.h)}, rot = ${num(v.rot)}, op = ${num(v.op)} }`;

/** Lua defining `make(from, vel0)`, which returns `solve(t) -> pos, vel, done`. */
function strategy(transition: Transition): string {
  if (transition.type === "spring") {
    const { stiffness, damping, mass } = springPhysics(transition);
    return `
  local W0, ZETA = ${num(Math.sqrt(stiffness / mass))}, ${num(damping / (2 * Math.sqrt(stiffness * mass)))}
  -- A damped spring from (x0, v0) to target, per dimension: x(t) and x'(t), closed form.
  local function spring(x0, v0, target)
    local dx = x0 - target
    if ZETA < 1 then
      local wd = W0 * math.sqrt(1 - ZETA * ZETA)
      local A, B = dx, (v0 + ZETA * W0 * dx) / wd
      return function(t)
        local e, c, s = math.exp(-ZETA * W0 * t), math.cos(wd * t), math.sin(wd * t)
        return target + e * (A * c + B * s), e * ((B * wd - ZETA * W0 * A) * c - (A * wd + ZETA * W0 * B) * s)
      end
    elseif ZETA == 1 then
      local A, B = dx, v0 + W0 * dx
      return function(t)
        local e = math.exp(-W0 * t)
        return target + e * (A + B * t), e * (B - W0 * (A + B * t))
      end
    else
      local s = W0 * math.sqrt(ZETA * ZETA - 1)
      local r1, r2 = -ZETA * W0 + s, -ZETA * W0 - s
      local B = (v0 - r1 * dx) / (r2 - r1)
      local A = dx - B
      return function(t)
        local e1, e2 = math.exp(r1 * t), math.exp(r2 * t)
        return target + A * e1 + B * e2, A * r1 * e1 + B * r2 * e2
      end
    end
  end
  local function make(from, vel0)
    local solvers = {}
    for _, d in ipairs(DIMS) do solvers[d] = spring(from[d], vel0[d], TO[d]) end
    return function(t)
      local pos, vel, done = {}, {}, t > 0
      for _, d in ipairs(DIMS) do
        pos[d], vel[d] = solvers[d](t)
        if math.abs(pos[d] - TO[d]) > REST_DELTA[d] or math.abs(vel[d]) > REST_SPEED[d] then done = false end
      end
      return pos, vel, done or t > 10
    end
  end`;
  }
  const { duration, delay = 0 } = transition;
  const curve = sampleEase(transition.ease, duration);
  return `
  local DURATION, DELAY, BLEND = ${num(duration)}, ${num(delay)}, ${num(Math.min(0.25, duration))}
  local CURVE = { ${curve.join(", ")} }
  local function ease(p)
    local x = p * (#CURVE - 1)
    local i = math.floor(x)
    if i >= #CURVE - 1 then return CURVE[#CURVE], 0 end
    local f = x - i
    return CURVE[i + 1] * (1 - f) + CURVE[i + 2] * f, (CURVE[i + 2] - CURVE[i + 1]) * (#CURVE - 1) / DURATION
  end
  -- The offset that makes an interrupted tween continuous (Bollo's inertialization quintic):
  -- starts with the velocity the tween lacks and reaches zero with zero velocity and acceleration.
  local function inertial(v0, t1)
    if v0 == 0 then return function() return 0, 0 end end
    local a0 = -8 * v0 / t1
    local A = -(a0 * t1 * t1 + 6 * v0 * t1) / (2 * t1 ^ 5)
    local B = (3 * a0 * t1 * t1 + 16 * v0 * t1) / (2 * t1 ^ 4)
    local C = -(3 * a0 * t1 * t1 + 12 * v0 * t1) / (2 * t1 ^ 3)
    return function(t)
      if t >= t1 then return 0, 0 end
      return A * t ^ 5 + B * t ^ 4 + C * t ^ 3 + a0 / 2 * t * t + v0 * t,
        5 * A * t ^ 4 + 4 * B * t ^ 3 + 3 * C * t * t + a0 * t + v0
    end
  end
  local function make(from, vel0)
    local _, slope0 = ease(0)
    local offsets = {}
    for _, d in ipairs(DIMS) do offsets[d] = inertial(vel0[d] - (TO[d] - from[d]) * slope0, BLEND) end
    return function(t)
      local p = math.max(0, math.min((t - DELAY) / DURATION, 1))
      local e, slope = ease(p)
      local pos, vel = {}, {}
      for _, d in ipairs(DIMS) do
        local ox, ov = offsets[d](math.max(0, t - DELAY))
        pos[d] = from[d] + (TO[d] - from[d]) * e + ox
        vel[d] = (TO[d] - from[d]) * slope + ov
      end
      return pos, vel, p >= 1
    end
  end`;
}

/** The Lua source of one chunk. */
export function generateChunk(spec: ChunkSpec): string {
  return `-- generated by @strangecyan/vignette-motion: ${spec.sceneName} #${String(spec.sceneItemId)} ${spec.label}
return function(obs, inherited)
  local SCENE, ITEM, FILTER_INPUT = ${JSON.stringify(spec.sceneName)}, ${String(spec.sceneItemId)}, ${JSON.stringify(spec.opacityInput ?? "")}
  local FROM, TO = ${visual(spec.from)}, ${visual(spec.to)}
  local HIDE_AT_END = ${spec.hideAtEnd === true ? "true" : "false"}
  local DIMS = { "cx", "cy", "w", "h", "rot", "op" }
  local REST_DELTA = { cx = 0.5, cy = 0.5, w = 0.5, h = 0.5, rot = 0.05, op = 0.005 }
  local REST_SPEED = { cx = 2, cy = 2, w = 2, h = 2, rot = 0.2, op = 0.01 }

  local scene_source = obs.obs_get_source_by_name(SCENE)
  if scene_source == nil then error("no scene " .. SCENE) end
  local item = obs.obs_scene_find_sceneitem_by_id(obs.obs_scene_from_source(scene_source), ITEM)
  obs.obs_source_release(scene_source)
  if item == nil then error("no item " .. ITEM .. " in " .. SCENE) end
  obs.obs_sceneitem_addref(item)

  local filter = nil
  if FILTER_INPUT ~= "" then
    local input = obs.obs_get_source_by_name(FILTER_INPUT)
    if input ~= nil then
      filter = obs.obs_source_get_filter_by_name(input, "vignette/opacity")
      obs.obs_source_release(input)
    end
  end

  local function read()
    local p, b = obs.vec2(), obs.vec2()
    obs.obs_sceneitem_get_pos(item, p)
    obs.obs_sceneitem_get_bounds(item, b)
    local r = obs.obs_sceneitem_get_rot(item)
    local a = math.rad(r)
    local hx, hy = b.x / 2, b.y / 2
    local op = 1
    if filter ~= nil then
      local s = obs.obs_source_get_settings(filter)
      op = obs.obs_data_get_double(s, "opacity")
      obs.obs_data_release(s)
    end
    return { cx = p.x + hx * math.cos(a) - hy * math.sin(a), cy = p.y + hx * math.sin(a) + hy * math.cos(a), w = b.x, h = b.y, rot = r, op = op }
  end

  local function write(v)
    local a = math.rad(v.rot)
    local hx, hy = v.w / 2, v.h / 2
    local p, b = obs.vec2(), obs.vec2()
    p.x = v.cx - (hx * math.cos(a) - hy * math.sin(a))
    p.y = v.cy - (hx * math.sin(a) + hy * math.cos(a))
    b.x, b.y = math.max(v.w, 1), math.max(v.h, 1)
    obs.obs_sceneitem_defer_update_begin(item)
    obs.obs_sceneitem_set_pos(item, p)
    obs.obs_sceneitem_set_bounds(item, b)
    obs.obs_sceneitem_set_rot(item, v.rot)
    obs.obs_sceneitem_defer_update_end(item)
    if filter ~= nil then
      local s = obs.obs_data_create()
      obs.obs_data_set_double(s, "opacity", math.max(0, math.min(1, v.op)))
      obs.obs_source_update(filter, s)
      obs.obs_data_release(s)
    end
  end
${strategy(spec.transition)}

  -- Start where the predecessor left off, with its velocity; else at FROM, else as the item is.
  local from = inherited and inherited.pos or FROM or read()
  local vel0 = inherited and inherited.vel or { cx = 0, cy = 0, w = 0, h = 0, rot = 0, op = 0 }
  if inherited == nil and FROM ~= nil then write(FROM) end
  local solve = make(from, vel0)
  local t, released = 0, false
  local last_pos, last_vel = from, vel0

  local function release()
    if released then return end
    released = true
    if filter ~= nil then obs.obs_source_release(filter) end
    obs.obs_sceneitem_release(item)
  end

  return {
    tick = function(dt)
      t = t + dt
      local pos, vel, done = solve(t)
      last_pos, last_vel = pos, vel
      write(done and TO or pos)
      -- Shown after its first frame is written, so a new item never flashes at the wrong place.
      if not HIDE_AT_END and not obs.obs_sceneitem_visible(item) then obs.obs_sceneitem_set_visible(item, true) end
      if done then
        if HIDE_AT_END then obs.obs_sceneitem_set_visible(item, false) end
        release()
        return true
      end
      return false
    end,
    handoff = function()
      release()
      return { pos = last_pos, vel = last_vel }
    end,
  }
end
`;
}

/** Roughly when a transition is over, for waiting on an exit: springs settle to 0.1%. */
export function settleSeconds(transition: Transition): number {
  if (transition.type === "tween") return (transition.delay ?? 0) + transition.duration;
  const { stiffness, damping, mass } = springPhysics(transition);
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return Math.min(10, 6.9 / (Math.min(zeta, 1) * w0));
}
