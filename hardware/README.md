# RackSense — Firmware

Three sketches, one job each. This is the only code in the kit; the frontend and backend are
built by Antigravity from the prompts in `prompts/`.

| Sketch | Board | Node | Publishes |
|---|---|---|---|
| `node_env_esp32/` | ESP32 Dev Module | `r1-n1` | `t_c`, `rh`, `dew_c`, `mq_ratio`, `shock_count` |
| `node_vib_esp32s3/` | ESP32S3 Dev Module | `r2-n1` | `vib_rms_g`, `vib_peak_g`, `vib_crest` |
| `auth_console_esp32s3/` | ESP32S3 Dev Module (N16R8) | `reader-01` | — (HTTP only: RFID taps + TFT) |

Wiring: `../shared/hardware-connections.md`. Circuit diagram prompt:
`../prompts/05-circuit-diagram.md`.

---

## Before you flash

1. **Copy the secrets file in each sketch folder:**
   ```
   cp secrets.example.h secrets.h
   ```
   Fill in Wi-Fi, the UNO Q's address, the per-node MQTT credentials, and (for the reader) the
   per-device HMAC secret. `secrets.h` is gitignored and must never be committed.

2. **Check the pin map.** Every pin is a named constant in that sketch's `config.h`. The values
   are the firmware defaults chosen to avoid strapping, flash/PSRAM and ADC2 pins. If your
   bench differs, change `config.h` — no logic references a raw pin number.

3. **Match the IDs to the backend.** `SITE_ID`, `RACK_ID`, `NODE_ID`, `TENANT_ID` and
   `DEVICE_ID` must match the topology YAML the backend seeds from. A mismatch means telemetry
   arrives for a node the server does not know. The integration prompt asks for a script that
   checks both and reports differences — run it before the demo.

4. **Give the UNO Q a static IP or a reserved lease.** Both the broker address and the reader's
   API base point at it.

---

## Libraries

| Sketch | Libraries |
|---|---|
| `node_env_esp32` | PubSubClient 2.8+, ArduinoJson 7+, Adafruit DHT 1.4+, Adafruit Unified Sensor |
| `node_vib_esp32s3` | PubSubClient 2.8+, ArduinoJson 7+ (MPU6050 driven directly over `Wire` — no driver library) |
| `auth_console_esp32s3` | LovyanGFX 1.1.16+, MFRC522 1.4.x, ArduinoJson 7+ |

Board package: `esp32` by Espressif, 3.x recommended.

Reference repositories:
- https://github.com/knolleary/pubsubclient
- https://github.com/bblanchon/ArduinoJson
- https://github.com/adafruit/DHT-sensor-library
- https://github.com/adafruit/Adafruit_Sensor
- https://github.com/miguelbalboa/rfid
- https://github.com/lovyan03/LovyanGFX
- https://github.com/espressif/arduino-esp32

---

## Board settings

**ESP32 Dev Module** (environment node): defaults are fine.

**ESP32S3 Dev Module** (both S3 sketches):
- USB CDC On Boot: **Enabled** (so you get serial output over the native USB port)
- Flash Size: **16MB**
- PSRAM: **OPI PSRAM** — required on an N16R8. Getting this wrong gives you a board that boots
  and then behaves strangely.
- Partition Scheme: any 16MB scheme with enough app space.

---

## Decisions in this firmware, and why

These are deliberate. If you change one, know what you are trading away.

**Features on the node, scoring on the server.** The vibration node sends RMS, peak and crest
per 2-second window — not 400 raw samples per axis. The server reduces raw data to exactly
these three numbers anyway, so sending the rest would be ~5 KB/s of JSON for nothing.

**Absent fields instead of substituted ones.** A failed DHT22 read clears the value and the
field is omitted from the payload. No last-known value, no interpolation, no zero. The gap is
the signal. The same applies to a window with too few vibration samples — it is dropped, and
the `seq` gap tells the server a sample was lost.

**`mq_warm` instead of a number.** The MQ135 datasheet specifies over 24 hours of preheat. The
firmware tracks that from a first-boot epoch persisted in NVS, so a reboot does not reset the
clock. Until preheat completes, `mq_ratio` is omitted entirely and the backend returns
`SENSOR_WARMING_UP`. A warming sensor produces a number; it does not produce a *meaningful*
one, and showing it would be the kind of quiet dishonesty this project is built to avoid.

**Ratio, never ppm.** The MQ135 is broadly cross-sensitive (ammonia, benzene, alcohol, smoke,
CO₂) and strongly temperature- and humidity-dependent. `Rs/R0` against a clean-air baseline is
defensible; a ppm figure is not. `R0` is captured by an explicit operator command on the `cmd`
topic — never automatically, because a baseline captured in dirty air silently corrupts every
later ratio.

**Vibration relative to its own baseline.** ISO 10816/20816 severity zones are defined for
machines of 15 kW to 300 kW measured as velocity in a 10–1000 Hz band. A 5 V rack fan is not
such a machine, and the MPU6050's noise floor makes integrating to velocity meaningless at
these amplitudes. The server compares RMS to this node's captured baseline — 2× warn, 4×
critical — and the axis reads "× baseline".

**`setBufferSize(1024)` before connecting.** PubSubClient's default buffer is 256 bytes
*including the topic*. A JSON payload plus a long topic silently fails to publish, with no
error anywhere. This single line saves hours.

**Last Will and Testament on every node.** The broker publishes `offline` for a node that
disappears, so node presence is a known fact rather than a timeout guess. This is also what
makes the live "new tenant joins" demo honest — the server logs `NODE_ONLINE` as an event it
actually observed, separate from any statistical change it then detects.

**Ring buffer with original timestamps.** Readings taken while the broker is unreachable are
replayed on reconnect carrying the timestamp they were taken at. The server stores `received_at`
separately and flags them backfilled, so a reconnection burst is never mistaken for live data.

**No timestamp, no publish.** If NTP has not synced, the reading is dropped rather than stamped
with a guess. The `seq` gap records that a sample existed and was lost.

**Non-blocking everywhere.** No `delay()` in `loop()`, no `while (!connected)`. Reconnects use
capped exponential backoff. A node that blocks stops sampling, and a gap in the series is a gap
in the forecast.

**The reader holds no authority.** It polls for an action the server has already armed, displays
it, reads a card, and relays `{uid, nonce, ts, hmac}`. There is no local allowlist, no risk-tier
logic, no cached approval, and no offline path. A device that could invent its own authority
would be a way to launder an unapproved action into something that looks official.

**Authorization uses HTTP, not MQTT.** It must not travel on a bus that other devices can
publish to.

---

## Commissioning, in order

1. Flash all three boards. Confirm each prints its boot JSON on serial.
2. Confirm the RC522 version register reads `0x91` or `0x92` (a `0x00` or `0xFF` means wiring or
   power — remember it is **3.3 V only**).
3. Power the MQ135 and leave it on. Note the time; preheat is 24 hours.
4. Confirm telemetry arrives: `mosquitto_sub -h <unoq> -t 'dc/#' -v`.
5. Capture the vibration baseline over 5 quiet minutes (backend endpoint; record the sample
   count).
6. After preheat, capture the MQ135 clean-air `R0` by publishing
   `{"cmd":"calibrate_mq_r0"}` to the env node's `cmd` topic, **in clean air**.
7. Register the reader on the server with its `DEVICE_ID` and HMAC secret; register the card
   UIDs against real people.
8. Run the end-to-end smoke test from the integration prompt.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Node connects but no telemetry arrives | `setBufferSize` too small, or the topic is longer than you think. Check the serial log for publish failures. |
| MQ135 reads nothing / full scale | The 2:1 divider is missing or on the wrong pin. `AO` can swing to 5 V; the ADC takes 3.3 V. |
| MQ135 value jumps when Wi-Fi connects | The sensor is on an ADC2 pin. Move it to ADC1 (GPIO32–39). This is the classic ESP32 analog bug. |
| S3 board boots then behaves strangely | PSRAM setting wrong for an N16R8, or a pin in GPIO26–37 is in use — those are flash and Octal PSRAM. |
| RC522 version register reads `0x00`/`0xFF` | Power or wiring. It is 3.3 V only. Check SS and RST against `config.h`. |
| Taps rejected with `CLOCK_SKEW` | The reader's clock has drifted. It re-syncs hourly; check NTP reachability. |
| Taps rejected with `HMAC_INVALID` | `DEVICE_HMAC_SECRET` does not match the server's record for this `DEVICE_ID`. |
| Display blank but serial is fine | Backlight pin, or the panel is sharing the bus without `bus_shared = true`. |
