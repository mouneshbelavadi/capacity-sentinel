// =====================================================================
//  RackSense - Environment node  -  config.h
//  Board: "ESP32 Dev Module" (classic ESP32, 38-pin)
//
//  EVERY pin is a named constant. Change them here and nowhere else.
//  These are the firmware defaults, chosen to avoid strapping pins and
//  ADC2 (unusable while Wi-Fi is active). If your bench differs, edit
//  this file only - no logic references a raw pin number.
// =====================================================================
#pragma once

// ---------------------------------------------------------------- identity
#define SITE_ID            "site-01"
#define RACK_ID            "rack-01"
#define NODE_ID            "r1-n1"
#define TENANT_ID          "t-alpha"      // declared mapping; the server is authoritative
#define FW_VERSION         "0.3.1"

// ---------------------------------------------------------------- pins
// DHT22 data line. 10k pull-up to 3V3 required.
#define PIN_DHT22          4

// MQ135 analog output, AFTER the mandatory 2:1 divider (10k/10k).
// GPIO34 is ADC1 and input-only. ADC2 pins CANNOT be read while Wi-Fi
// is active - never move this to GPIO 0/2/4/12-15/25-27.
#define PIN_MQ135_AO       34

// SW-420 digital output (interrupt-capable).
#define PIN_SW420_DO       27

// Onboard status LED (optional).
#define PIN_STATUS_LED     2

// ---------------------------------------------------------------- MQ135 analog chain
#define MQ135_DIVIDER_RATIO   2.0f      // two 10k resistors => Vsensor = Vadc * 2
#define MQ135_VCC_MV          5000.0f   // heater/module supply rail
#define MQ135_RL_OHMS         10000.0f  // load resistor on the module (check your board)

// Datasheet preheat is "over 24 hours". Tracked across reboots via NVS
// using the first-ever boot epoch, not millis().
#define MQ135_PREHEAT_SECONDS (24UL * 60UL * 60UL)

// ---------------------------------------------------------------- timing
#define TELEMETRY_PERIOD_MS   2000UL    // contract: publish every 2 s
#define DHT_MIN_PERIOD_MS     2000UL    // AM2302 cannot be read faster than this
#define MQ_SAMPLE_PERIOD_MS   500UL
#define SHOCK_WINDOW_MS       2000UL    // SW-420 events counted per publish window
#define SHOCK_DEBOUNCE_MS     50UL

// ---------------------------------------------------------------- network
#define MQTT_PORT             1883
#define MQTT_KEEPALIVE_S      15
#define MQTT_BUFFER_BYTES     1024      // MUST exceed topic + payload. The
                                        // PubSubClient default of 256 silently
                                        // drops publishes. This bug costs hours.
#define RECONNECT_MIN_MS      1000UL
#define RECONNECT_MAX_MS      30000UL

#define NTP_SERVER_1          "pool.ntp.org"
#define NTP_SERVER_2          "time.nist.gov"
#define TZ_OFFSET_SEC         0         // publish UTC; the server localises

// ---------------------------------------------------------------- offline buffer
// Readings held while the broker is unreachable, replayed on reconnect
// with their ORIGINAL timestamps and flagged backfilled by the server.
#define RINGBUF_ENTRIES       120       // ~4 minutes at 2 s cadence

// ---------------------------------------------------------------- topics
#define TOPIC_TELEMETRY    "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/telemetry"
#define TOPIC_STATUS       "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/status"
#define TOPIC_CMD          "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/cmd"
