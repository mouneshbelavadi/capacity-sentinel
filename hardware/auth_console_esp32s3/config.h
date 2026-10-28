// =====================================================================
//  RackSense - Authorization console  -  config.h
//  Board: "ESP32S3 Dev Module"  (ESP32-S3-WROOM-1 N16R8)
//
//  EVERY pin is a named constant. Change them here and nowhere else.
//  This wiring matches the team's existing SAAKSHI build - nothing on
//  the breadboard has to move.
// =====================================================================
#pragma once

// ---------------------------------------------------------------- identity
#define DEVICE_ID          "reader-01"
#define FW_VERSION         "0.3.1"

// ---------------------------------------------------------------- shared SPI bus
// The ILI9488 TFT and the RC522 share one bus with separate chip selects.
#define PIN_SPI_SCK        12
#define PIN_SPI_MOSI       11
#define PIN_SPI_MISO       13

// ---------------------------------------------------------------- TFT (ILI9488 480x320)
#define PIN_TFT_CS         10
#define PIN_TFT_DC         14
#define PIN_TFT_RST        21
#define PIN_TFT_BL         47

// ---------------------------------------------------------------- RC522 RFID
// The RC522 is 3.3 V ONLY. 5 V destroys it.
#define PIN_RFID_SS        9
#define PIN_RFID_RST       8

// ---------------------------------------------------------------- status LED
#define PIN_RGB_LED        48
#define RGB_BRIGHTNESS     40          // 0-255; keep low, it is a status light

// Never use GPIO26-37 on an N16R8: SPI flash and Octal PSRAM live there.
// GPIO0/3/45/46 are strapping pins. GPIO19/20 are native USB.

// ---------------------------------------------------------------- timing
#define POLL_PERIOD_MS        1000UL   // GET /pending  (contract budget: 1.5 s to screen)
#define HEARTBEAT_PERIOD_MS   30000UL
#define NTP_RESYNC_PERIOD_MS  3600000UL  // hourly; the tap HMAC carries a timestamp
#define UID_REPEAT_LOCKOUT_MS 3000UL   // ignore the same card re-presented this fast
#define RESULT_DWELL_MS       6000UL   // how long a result stays on screen
#define HTTP_TIMEOUT_MS       4000

// ---------------------------------------------------------------- server
#define API_PORT           8000
#define API_BASE_PATH      "/api/reader/" DEVICE_ID

// ---------------------------------------------------------------- NTP
#define NTP_SERVER_1       "pool.ntp.org"
#define NTP_SERVER_2       "time.nist.gov"
#define TZ_OFFSET_SEC      0           // UTC; the server localises

// ---------------------------------------------------------------- display
#define SCREEN_W           480
#define SCREEN_H           320
