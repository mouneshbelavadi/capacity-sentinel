// =====================================================================
//  RackSense - Vibration node  -  config.h
//  Board: "ESP32S3 Dev Module"
//
//  EVERY pin is a named constant. Change them here and nowhere else.
// =====================================================================
#pragma once

// ---------------------------------------------------------------- identity
#define SITE_ID            "site-01"
#define RACK_ID            "rack-02"
#define NODE_ID            "r2-n1"
#define TENANT_ID          "t-beta"
#define FW_VERSION         "0.3.1"

// ---------------------------------------------------------------- pins
// MPU6050 over I2C. AD0 tied to GND => address 0x68.
#define PIN_I2C_SDA        8
#define PIN_I2C_SCL        9
#define PIN_MPU_INT        4          // optional; firmware polls if unwired
#define PIN_STATUS_LED     48         // onboard WS2812 on most S3 dev kits

// Never use GPIO26-37 on an ESP32-S3-WROOM-1 N16R8: SPI flash and Octal
// PSRAM live there. GPIO0/3/45/46 are strapping pins. GPIO19/20 are USB.

// ---------------------------------------------------------------- MPU6050
#define MPU_I2C_ADDR       0x68
#define I2C_CLOCK_HZ       400000UL

// +/-2 g full scale gives the best resolution for small-fan vibration.
#define MPU_ACCEL_FS_SEL   0            // 0 = +/-2g
#define MPU_LSB_PER_G      16384.0f     // for +/-2g

// ---------------------------------------------------------------- sampling
#define SAMPLE_RATE_HZ     200UL
#define SAMPLE_PERIOD_US   (1000000UL / SAMPLE_RATE_HZ)
#define WINDOW_MS          2000UL       // one publish window
#define WINDOW_SAMPLES     (SAMPLE_RATE_HZ * WINDOW_MS / 1000UL)   // 400

// ---------------------------------------------------------------- timing
#define TELEMETRY_PERIOD_MS   2000UL

// ---------------------------------------------------------------- network
#define MQTT_PORT             1883
#define MQTT_KEEPALIVE_S      15
#define MQTT_BUFFER_BYTES     1024      // PubSubClient default of 256 silently drops
#define RECONNECT_MIN_MS      1000UL
#define RECONNECT_MAX_MS      30000UL

#define NTP_SERVER_1          "pool.ntp.org"
#define NTP_SERVER_2          "time.nist.gov"
#define TZ_OFFSET_SEC         0

// ---------------------------------------------------------------- offline buffer
#define RINGBUF_ENTRIES       180       // ~6 minutes at 2 s cadence (S3 has PSRAM)

// ---------------------------------------------------------------- topics
#define TOPIC_TELEMETRY    "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/telemetry"
#define TOPIC_STATUS       "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/status"
#define TOPIC_CMD          "dc/" SITE_ID "/" RACK_ID "/" NODE_ID "/cmd"
