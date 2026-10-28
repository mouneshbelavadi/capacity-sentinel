# RackSense — Hardware Connections (full wiring reference)

> **Read this first.** The pin numbers below are the **defaults the shipped firmware is
> written against**, chosen to avoid strapping pins, flash/PSRAM pins and ADC2 (which is
> unusable while Wi-Fi is on). They are a *declared default*, not a reading of your bench.
> If your wiring differs, change the values in that board's `config.h` — **nothing else in the
> firmware needs to change**, every pin is referenced through a single named constant.

Three boards. Each is one job.

| Board | Role | Node ID | Publishes |
|---|---|---|---|
| ESP32 dev module | Environment node | `r1-n1` | `t_c`, `rh`, `dew_c`, `mq_ratio`, `shock_count` |
| ESP32-S3 #2 | Vibration node | `r2-n1` | `vib_rms_g`, `vib_peak_g`, `vib_crest` |
| ESP32-S3 #1 | Authorization console | `reader-01` | — (HTTP only; RFID taps + TFT) |

---

## Board 1 — ESP32 dev module → environment node (`r1-n1`)

### Netlist

| From | Pin | To | Pin | Note |
|---|---|---|---|---|
| ESP32 | 3V3 | DHT22 | VCC | |
| ESP32 | GND | DHT22 | GND | |
| ESP32 | **GPIO4** | DHT22 | DATA | 10 kΩ pull-up from DATA to 3V3 |
| ESP32 | VIN (5V) | MQ135 | VCC | **Heater needs 5 V, ~150 mA. Do not run from 3V3.** |
| ESP32 | GND | MQ135 | GND | |
| MQ135 | AO | Divider R1 | — | R1 = 10 kΩ in series |
| Divider node | — | ESP32 **GPIO34** | — | R2 = 10 kΩ from node to GND |
| Divider node | — | ESP32 | — | 2:1 divider → max ≈ 2.5 V at the ADC |
| ESP32 | 3V3 | SW-420 | VCC | |
| ESP32 | GND | SW-420 | GND | |
| ESP32 | **GPIO27** | SW-420 | DO | Digital, interrupt-capable |
| ESP32 | GPIO2 | onboard LED | — | Status blink (optional) |

### Why these pins

- **GPIO34** is ADC1, input-only. **ADC2 cannot be read while Wi-Fi is active** — this is the
  single most common ESP32 analog bug. Never move the MQ135 to GPIO 0/2/4/12–15/25–27.
- **GPIO4 / GPIO27** avoid the strapping pins (0, 2, 5, 12, 15) and the flash pins (6–11).
- The **MQ135 AO voltage divider is mandatory.** The module is powered at 5 V and its analog
  output can swing to ~5 V; the ESP32 ADC is 3.3 V maximum. Two 10 kΩ resistors fix it.

### MQ135 operating notes (these are in the firmware)

- Datasheet preheat is **over 24 hours**. Power it from the start of the event and leave it on.
- The firmware publishes `mq_warm: false` until its preheat timer elapses; the backend then
  returns `SENSOR_WARMING_UP` instead of a number, and the UI shows "warming up".
- We publish **`Rs/R0` ratio only**, never ppm. The sensor is broadly cross-sensitive
  (ammonia, benzene, alcohol, smoke, CO₂) and strongly temperature/humidity dependent.
- `R0` is captured by a clean-air calibration routine on first boot and stored in NVS.

---

## Board 2 — ESP32-S3 #2 → vibration node (`r2-n1`)

### Netlist

| From | Pin | To | Pin | Note |
|---|---|---|---|---|
| ESP32-S3 | 3V3 | MPU6050 | VCC | GY-521 modules have an onboard regulator; 3V3 is safe |
| ESP32-S3 | GND | MPU6050 | GND | |
| ESP32-S3 | **GPIO8** | MPU6050 | SDA | I²C data, 4.7 kΩ pull-up to 3V3 if the module has none |
| ESP32-S3 | **GPIO9** | MPU6050 | SCL | I²C clock, 4.7 kΩ pull-up to 3V3 |
| ESP32-S3 | **GPIO4** | MPU6050 | INT | Optional; firmware polls if not wired |
| MPU6050 | AD0 | GND | — | Sets I²C address **0x68** |

Mount the MPU6050 **rigidly to the fan housing or rack rail**. A sensor taped to a loose wire
measures the wire, not the rack.

### Sampling

- Range ±2 g, sampled at **200 Hz**, 2-second windows.
- Per window the firmware computes **RMS, peak, crest factor** and publishes those three
  numbers — not raw samples. Features on the node, scoring on the server.
- Noise density is ~400 µg/√Hz, which is why we report **RMS relative to a captured baseline**
  (WARN 2×, CRIT 4×) and never integrate to mm/s velocity.

---

## Board 3 — ESP32-S3 #1 → authorization console (`reader-01`)

RC522 and the ILI9488 TFT **share one SPI bus** with separate chip selects. This matches the
team's existing SAAKSHI wiring — nothing on that breadboard has to move.

### Shared SPI bus

| Signal | ESP32-S3 pin |
|---|---|
| SCK | **GPIO12** |
| MOSI | **GPIO11** |
| MISO | **GPIO13** |

### TFT (3.5" ILI9488, 480×320)

| TFT pin | ESP32-S3 pin |
|---|---|
| CS | **GPIO10** |
| DC / RS | **GPIO14** |
| RST | **GPIO21** |
| LED / BL | **GPIO47** |
| SCK / MOSI / MISO | shared bus above |
| VCC | 3V3 (or 5 V if your module's regulator requires it — check the silkscreen) |
| GND | GND |

### RC522 RFID

| RC522 pin | ESP32-S3 pin |
|---|---|
| SDA / SS | **GPIO9** |
| RST | **GPIO8** |
| SCK / MOSI / MISO | shared bus above |
| 3.3V | 3V3 — **the RC522 is 3.3 V only. 5 V will destroy it.** |
| GND | GND |

### Status LED

| Signal | ESP32-S3 pin |
|---|---|
| WS2812 RGB (onboard on most S3 devkits) | **GPIO48** |

### Pins you must not use on an ESP32-S3-WROOM-1 **N16R8**

- **GPIO26–GPIO37** — SPI flash and **Octal PSRAM**. Using any of these on an R8 module will
  crash or corrupt the board. This is the one that bites people.
- **GPIO0, 3, 45, 46** — strapping pins.
- **GPIO19, 20** — native USB D− / D+.

Every pin chosen above sits outside those ranges.

---

## Power

| Rail | Feeds | Note |
|---|---|---|
| 5 V | MQ135 heater, TFT backlight (via module regulator) | MQ135 heater alone is ~0.8–0.95 W — it dominates node power |
| 3.3 V | DHT22, SW-420, MPU6050, RC522 | RC522 is 3.3 V **only** |

**All grounds must be common.** Each board gets its own USB supply for the demo; tie the GNDs
together if any sensor is shared across boards.

### Optional upgrade — INA219 (not currently fitted)

If you add one, it goes on the **I²C bus of the vibration node** (SDA GPIO8 / SCL GPIO9,
address 0x40 — no clash with the MPU6050 at 0x68), with its shunt **in series with the 5 V feed**
of one node. It measures 0–26 V and ±3.2 A with the stock 0.1 Ω shunt.

Label anything it produces as `measured`, `source: "node DC rail"`. It measures **one low-voltage
DC rail of the mock rack** — not mains AC, and not a real server. Saying otherwise would be
the exact kind of overclaim this project refuses.

---

## Network

All three boards join the same Wi-Fi as the Arduino UNO Q. The UNO Q runs the Mosquitto broker
and the FastAPI server.

| Setting | Value |
|---|---|
| MQTT broker | UNO Q IP, port 1883 |
| Nodes publish | `dc/site-01/{rack}/{node}/telemetry` every 2000 ms, QoS 0 |
| Node presence | `dc/site-01/{rack}/{node}/status`, retained, LWT `"offline"` |
| Reader talks to | `http://<unoq-ip>:8000/api/reader/...` (HTTP, not MQTT — authorization never rides MQTT) |
| Time | NTP at boot; the reader re-syncs hourly (tap HMAC includes a timestamp) |

The reader deliberately **does not use MQTT**. Authorization must not travel on a bus that
anything else can publish to.
