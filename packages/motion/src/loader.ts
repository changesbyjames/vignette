/**
 * The one hand-installed Lua script. Each video frame it reads `commands.json` in its directory,
 * runs any new chunk with `loadfile`, ticks the live chunks and writes `state.json` back. One
 * live chunk per key; a new chunk for a key takes the old one's position and velocity over.
 */
export const LOADER_VERSION = "1";

export const LOADER_LUA = `-- Vignette motion loader v${LOADER_VERSION}. Add this script under Tools > Scripts once; the
-- @strangecyan/vignette-motion OBS plugin writes everything else next to it.
local obs = obslua

local dir = script_path()
local COMMANDS, STATE = dir .. "commands.json", dir .. "state.json"
local VERSION = "${LOADER_VERSION}"

local live, live_count = {}, 0
local last_seq = -1
local stats = { loads = 0, handoffs = 0, errors = 0, done = 0 }
local done_keys, last_error = {}, ""

local function log(fmt, ...) obs.script_log(obs.LOG_INFO, string.format(fmt, ...)) end
function script_description() return "Vignette motion loader v" .. VERSION end

local function fail(stage, what, err)
  stats.errors = stats.errors + 1
  last_error = tostring(err)
  log("%s %s failed: %s", stage, what, last_error)
end

local function load_chunk(key, path)
  local factory, err = loadfile(path)
  if factory == nil then return fail("load", path, err) end
  local ok, make = pcall(factory)
  if not ok or type(make) ~= "function" then return fail("run", path, make) end
  local inherited, previous = nil, live[key]
  if previous ~= nil and previous.handoff ~= nil then
    local hok, state = pcall(previous.handoff)
    if hok then inherited = state; stats.handoffs = stats.handoffs + 1 else fail("handoff", key, state) end
  end
  local cok, chunk = pcall(make, obs, inherited)
  if not cok or type(chunk) ~= "table" then return fail("start", path, chunk) end
  if previous == nil then live_count = live_count + 1 end
  live[key] = chunk
  stats.loads = stats.loads + 1
end

local function write_state(seq)
  local s = obs.obs_data_create()
  obs.obs_data_set_string(s, "loader", VERSION)
  obs.obs_data_set_int(s, "ack_seq", seq)
  obs.obs_data_set_int(s, "loads", stats.loads)
  obs.obs_data_set_int(s, "handoffs", stats.handoffs)
  obs.obs_data_set_int(s, "errors", stats.errors)
  obs.obs_data_set_int(s, "live", live_count)
  obs.obs_data_set_string(s, "done", table.concat(done_keys, ","))
  obs.obs_data_set_string(s, "last_error", last_error)
  obs.obs_data_save_json_safe(s, STATE, "tmp", "bak")
  obs.obs_data_release(s)
end

local function read_commands()
  local s = obs.obs_data_create_from_json_file(COMMANDS)
  if s == nil then return end
  local seq = obs.obs_data_get_int(s, "seq")
  if seq ~= last_seq then
    last_seq = seq
    local loads = obs.obs_data_get_array(s, "load")
    if loads ~= nil then
      for i = 0, obs.obs_data_array_count(loads) - 1 do
        local d = obs.obs_data_array_item(loads, i)
        load_chunk(obs.obs_data_get_string(d, "key"), obs.obs_data_get_string(d, "path"))
        obs.obs_data_release(d)
      end
      obs.obs_data_array_release(loads)
    end
    write_state(seq)
  end
  obs.obs_data_release(s)
end

function script_tick(seconds)
  read_commands()
  if live_count == 0 then return end
  local finished = false
  for key, chunk in pairs(live) do
    local ok, result = pcall(chunk.tick, seconds)
    if not ok then fail("tick", key, result) end
    if not ok or result == true then
      live[key] = nil
      live_count = live_count - 1
      stats.done = stats.done + 1
      done_keys[#done_keys + 1] = key
      if #done_keys > 64 then table.remove(done_keys, 1) end
      finished = true
    end
  end
  if finished then write_state(last_seq) end
end

function script_load(settings) write_state(last_seq) end
function script_unload() live = {}; live_count = 0 end
`;
