# CIRCUIT DIAGRAM PROMPT

**How to use this:** paste the block below into a circuit-diagram generation tool (Flux.ai,
CircuitLab, Cirkit Designer, an LLM that emits KiCad/Fritzing netlists, or a diagram model).
It is self-contained and uses the exact pin map the firmware is written against.

If your tool wants a **netlist** rather than prose, Part B gives the same wiring as a plain
net list you can paste directly.

**Verify before you wire.** The pin numbers are the firmware defaults. If your bench differs,
change `config.h` and update this prompt to match — they must never disagree.

---

## PART A — prose prompt for a diagram generator

Draw a clear, labelled wiring diagram for a three-board IoT sensing and authorization system.
Use a clean schematic style with labelled nets, not a photorealistic breadboard render. Group
each board in its own bounding box with a title. Label every wire with the signal name and the
GPIO number at each end. Use a light background and black text.

### Board 1 — "Environment node" — ESP32 dev module (38-pin)

Connect:
- **DHT22** temperature/humidity sensor: VCC to ESP32 3V3, GND to GND, DATA to **GPIO4**.
  Add a 10 kΩ pull-up resistor between DATA and 3V3.
- **MQ135** gas sensor module: VCC to ESP32 **VIN (5 V)**, GND to GND. Its analog output AO
  goes through a **2:1 resistor divider** — a 10 kΩ resistor from AO to the divider node, and a
  10 kΩ resistor from the divider node to GND — with the divider node connected to ESP32
  **GPIO34**. Label this divider clearly: "5 V → 3.3 V level shift, required".
- **SW-420** vibration switch module: VCC to 3V3, GND to GND, DO to **GPIO27**.

Annotate: "GPIO34 is ADC1 and input-only. ADC2 pins cannot be read while Wi-Fi is active."

### Board 2 — "Vibration node" — ESP32-S3 development board

Connect:
- **MPU6050** 6-axis IMU over I²C: VCC to 3V3, GND to GND, SDA to **GPIO8**, SCL to **GPIO9**,
  INT to **GPIO4**, AD0 to GND (setting I²C address 0x68).
- Add 4.7 kΩ pull-up resistors from SDA to 3V3 and SCL to 3V3, marked "fit only if the module
  has no on-board pull-ups".

Annotate: "Mount the MPU6050 rigidly to the fan housing or rack rail."

### Board 3 — "Authorization console" — ESP32-S3-WROOM-1 N16R8

This board drives a display and an RFID reader **sharing one SPI bus** with separate chip
selects.

Shared SPI bus:
- SCK — **GPIO12**
- MOSI — **GPIO11**
- MISO — **GPIO13**

Connect a **3.5-inch ILI9488 TFT display, 480×320, SPI**:
- CS to **GPIO10**
- DC/RS to **GPIO14**
- RST to **GPIO21**
- LED/backlight to **GPIO47**
- SCK, MOSI, MISO to the shared bus
- VCC to 3V3, GND to GND

Connect an **RC522 (MFRC522) RFID reader**:
- SDA/SS to **GPIO9**
- RST to **GPIO8**
- SCK, MOSI, MISO to the shared bus
- 3.3V to 3V3, GND to GND

Add a **WS2812 RGB status LED** on **GPIO48** (on-board on most ESP32-S3 dev kits).

Annotate in red: "RC522 is 3.3 V only — 5 V will destroy it."
Annotate: "On an N16R8 module, GPIO26–GPIO37 are used by SPI flash and Octal PSRAM and must not
be used. GPIO0, 3, 45, 46 are strapping pins. GPIO19/20 are native USB."

### Power section

Draw a power distribution block showing:
- A 5 V rail feeding: the MQ135 heater (~0.8–0.95 W — label it "dominates node power") and the
  TFT module's regulator.
- A 3.3 V rail feeding: DHT22, SW-420, MPU6050, RC522.
- **All grounds common.** Draw this explicitly as a single ground net tying all three boards
  together, with a note: "Common ground is mandatory."
- Each board powered by its own USB supply for the demo.

### Network block (dashed, logical — not wires)

Draw a dashed logical block showing:
- Board 1 and Board 2 publishing **MQTT over Wi-Fi** to an **Arduino UNO Q** running a
  Mosquitto broker and a FastAPI server.
- Board 3 (authorization console) talking to the same UNO Q over **HTTP**, with the label
  "HTTP, not MQTT — authorization never rides a shared bus".
- The UNO Q connected to a laptop running the dashboard.

### Optional, draw greyed out

An **INA219** current/voltage sensor on Board 2's I²C bus (SDA GPIO8, SCL GPIO9, address 0x40),
with its shunt in series with the 5 V feed of one node. Label: "Optional — not currently fitted.
Measures one low-voltage DC rail, not mains AC."

---

## PART B — net list (paste into a netlist-driven tool)

```
# ---- Board 1: ESP32 dev module (environment node) ----
NET  B1_3V3      : ESP32_1.3V3, DHT22.VCC, SW420.VCC
NET  B1_5V       : ESP32_1.VIN, MQ135.VCC
NET  GND         : ESP32_1.GND, DHT22.GND, MQ135.GND, SW420.GND
NET  DHT_DATA    : ESP32_1.GPIO4, DHT22.DATA, R1.1
NET  B1_3V3      : R1.2                        # R1 = 10k pull-up
NET  MQ_AO       : MQ135.AO, R2.1              # R2 = 10k series
NET  MQ_DIV      : R2.2, R3.1, ESP32_1.GPIO34  # R3 = 10k to GND  (2:1 divider)
NET  GND         : R3.2
NET  SW_DO       : SW420.DO, ESP32_1.GPIO27

# ---- Board 2: ESP32-S3 (vibration node) ----
NET  B2_3V3      : ESP32S3_2.3V3, MPU6050.VCC, R4.2, R5.2
NET  GND         : ESP32S3_2.GND, MPU6050.GND, MPU6050.AD0
NET  I2C_SDA     : ESP32S3_2.GPIO8, MPU6050.SDA, R4.1   # R4 = 4k7 pull-up
NET  I2C_SCL     : ESP32S3_2.GPIO9, MPU6050.SCL, R5.1   # R5 = 4k7 pull-up
NET  MPU_INT     : ESP32S3_2.GPIO4, MPU6050.INT

# ---- Board 3: ESP32-S3-WROOM-1 N16R8 (authorization console) ----
NET  SPI_SCK     : ESP32S3_3.GPIO12, TFT.SCK,  RC522.SCK
NET  SPI_MOSI    : ESP32S3_3.GPIO11, TFT.MOSI, RC522.MOSI
NET  SPI_MISO    : ESP32S3_3.GPIO13, TFT.MISO, RC522.MISO
NET  TFT_CS      : ESP32S3_3.GPIO10, TFT.CS
NET  TFT_DC      : ESP32S3_3.GPIO14, TFT.DC
NET  TFT_RST     : ESP32S3_3.GPIO21, TFT.RST
NET  TFT_BL      : ESP32S3_3.GPIO47, TFT.LED
NET  RFID_SS     : ESP32S3_3.GPIO9,  RC522.SDA
NET  RFID_RST    : ESP32S3_3.GPIO8,  RC522.RST
NET  RGB_LED     : ESP32S3_3.GPIO48, WS2812.DIN
NET  B3_3V3      : ESP32S3_3.3V3, TFT.VCC, RC522.VCC, WS2812.VCC
NET  GND         : ESP32S3_3.GND, TFT.GND, RC522.GND, WS2812.GND

# ---- Optional, not fitted ----
# NET I2C_SDA    : INA219.SDA        # address 0x40, shares Board 2 I2C
# NET I2C_SCL    : INA219.SCL
# INA219 shunt in series with the 5 V feed of one node
```

### Bill of materials

| Ref | Part | Qty |
|---|---|---|
| ESP32_1 | ESP32 dev module (38-pin) | 1 |
| ESP32S3_2 | ESP32-S3 dev board | 1 |
| ESP32S3_3 | ESP32-S3-WROOM-1 N16R8 | 1 |
| — | DHT22 / AM2302 | 1 |
| — | MQ135 gas sensor module | 1 |
| — | SW-420 vibration switch module | 1 |
| — | MPU6050 (GY-521) | 1 |
| — | 3.5" ILI9488 TFT, 480×320, SPI | 1 |
| — | RC522 (MFRC522) RFID reader + cards | 1 |
| R1 | 10 kΩ (DHT22 pull-up) | 1 |
| R2, R3 | 10 kΩ (MQ135 divider) | 2 |
| R4, R5 | 4.7 kΩ (I²C pull-ups, if needed) | 2 |
| — | Arduino UNO Q | 1 |
| INA219 | Optional, not fitted | 0 |

### Critical annotations — include all of these on the drawing

1. **RC522 is 3.3 V only.** 5 V destroys it.
2. **The MQ135 divider is mandatory.** Its AO can swing to 5 V; the ESP32 ADC takes 3.3 V max.
3. **GPIO34 is ADC1 and input-only.** ADC2 cannot be read while Wi-Fi is active.
4. **On the N16R8, GPIO26–37 are flash and Octal PSRAM.** Using them will crash the board.
5. **Common ground across all three boards is mandatory.**
6. **The MQ135 heater needs >24 h preheat** and dominates node power at ~0.8–0.95 W.
7. **Authorization uses HTTP, never MQTT.**
