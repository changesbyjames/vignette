/**
 * The one hand-installed Lua script. It runs on OBS's video thread, once per frame, so it does
 * nothing at rest: it listens for the `update` signal of each show's mailbox input
 * (`vignette/<show>/motion/mailbox`), reads the mailbox's settings only when that fires, runs any
 * chunk a command names with `loadfile`, and ticks the live chunks. One live chunk per key; a new
 * chunk for a key takes the old one's position and velocity over. It answers in the mailbox's
 * settings, which obs-websocket's `GetInputSettings` reads and which fire no signal.
 */
export const LOADER_VERSION = "2";

export const LOADER_LUA = `-- Vignette motion loader v${LOADER_VERSION}. Add this script under Tools > Scripts once; the
-- @strangecyan/vignette-motion OBS plugin does everything else through a mailbox input.
local obs = obslua

local VERSION = "${LOADER_VERSION}"
local MAILBOX = "/motion/mailbox"
local SCAN_SECONDS = 2

-- Mailboxes by input name: a weak reference, the last sequence applied, and what finished.
local mailboxes = {}
-- Live chunks by key: the chunk and the mailbox it came from.
local live, live_count = {}, 0
local stats = { loads = 0, handoffs = 0, errors = 0, done = 0 }
local last_error = ""
local scan_timer = 0

local function log(fmt, ...) obs.script_log(obs.LOG_INFO, string.format(fmt, ...)) end
function script_description() return "Vignette motion loader v" .. VERSION end

local function fail(stage, what, err)
  stats.errors = stats.errors + 1
  last_error = tostring(err)
  log("%s %s failed: %s", stage, what, last_error)
end

local function load_chunk(box, key, path)
  local factory, err = loadfile(path)
  if factory == nil then return fail("load", path, err) end
  local ok, make = pcall(factory)
  if not ok or type(make) ~= "function" then return fail("run", path, make) end
  local inherited, previous = nil, live[key]
  if previous ~= nil then
    local hok, state = pcall(previous.chunk.handoff)
    if hok then inherited = state; stats.handoffs = stats.handoffs + 1 else fail("handoff", key, state) end
  end
  local cok, chunk = pcall(make, obs, inherited)
  if not cok or type(chunk) ~= "table" then return fail("start", path, chunk) end
  if previous == nil then live_count = live_count + 1 end
  live[key] = { chunk = chunk, box = box }
  stats.loads = stats.loads + 1
end

-- Writes the loader's answer into the mailbox's live settings: no update signal, no file.
local function write_state(settings, box)
  obs.obs_data_set_string(settings, "loader", VERSION)
  obs.obs_data_set_int(settings, "ack_seq", box.seq)
  obs.obs_data_set_int(settings, "loads", stats.loads)
  obs.obs_data_set_int(settings, "handoffs", stats.handoffs)
  obs.obs_data_set_int(settings, "errors", stats.errors)
  obs.obs_data_set_int(settings, "live", live_count)
  obs.obs_data_set_string(settings, "done", table.concat(box.done, ","))
  obs.obs_data_set_string(settings, "last_error", last_error)
end

local function with_mailbox(name, box, fn)
  local source = obs.obs_weak_source_get_source(box.weak)
  if source == nil then
    mailboxes[name] = nil
    return
  end
  local settings = obs.obs_source_get_settings(source)
  fn(settings)
  obs.obs_data_release(settings)
  obs.obs_source_release(source)
end

local function read_mailbox(name, box)
  with_mailbox(name, box, function(settings)
    local seq = obs.obs_data_get_int(settings, "seq")
    if seq ~= box.seq then
      box.seq = seq
      local loads = obs.obs_data_get_array(settings, "load")
      if loads ~= nil then
        for i = 0, obs.obs_data_array_count(loads) - 1 do
          local d = obs.obs_data_array_item(loads, i)
          load_chunk(box, obs.obs_data_get_string(d, "key"), obs.obs_data_get_string(d, "path"))
          obs.obs_data_release(d)
        end
        obs.obs_data_array_release(loads)
      end
    end
    write_state(settings, box)
  end)
end

local function connect(source, name)
  local box = { weak = obs.obs_source_get_weak_source(source), seq = -1, dirty = true, done = {} }
  obs.signal_handler_connect(obs.obs_source_get_signal_handler(source), "update", function()
    box.dirty = true
  end)
  mailboxes[name] = box
  log("connected to %s", name)
end

-- Finds mailbox inputs not yet connected: a show's target creates its own when it first places.
local function scan()
  local sources = obs.obs_enum_sources()
  if sources == nil then return end
  for _, source in ipairs(sources) do
    local name = obs.obs_source_get_name(source)
    if name:sub(-#MAILBOX) == MAILBOX and mailboxes[name] == nil then connect(source, name) end
  end
  obs.source_list_release(sources)
end

function script_tick(seconds)
  scan_timer = scan_timer - seconds
  if scan_timer <= 0 then
    scan_timer = SCAN_SECONDS
    scan()
  end
  for name, box in pairs(mailboxes) do
    if box.dirty then
      box.dirty = false
      read_mailbox(name, box)
    end
  end
  if live_count == 0 then return end
  local finished = nil
  for key, entry in pairs(live) do
    local ok, result = pcall(entry.chunk.tick, seconds)
    if not ok then fail("tick", key, result) end
    if not ok or result == true then
      live[key] = nil
      live_count = live_count - 1
      stats.done = stats.done + 1
      local done = entry.box.done
      done[#done + 1] = key
      if #done > 64 then table.remove(done, 1) end
      finished = finished or {}
      finished[entry.box] = true
    end
  end
  if finished ~= nil then
    for name, box in pairs(mailboxes) do
      if finished[box] then with_mailbox(name, box, function(settings) write_state(settings, box) end) end
    end
  end
end

function script_unload() live = {}; live_count = 0; mailboxes = {} end
`;
