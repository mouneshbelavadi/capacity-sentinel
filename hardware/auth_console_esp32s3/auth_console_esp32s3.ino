/*  =====================================================================
    RackSense - Authorization console                        (fw 0.3.1)

    ESP32-S3-WROOM-1 N16R8  +  3.5" ILI9488 480x320  +  RC522
    ---------------------------------------------------------------------
    This device confirms an action a human has ALREADY approved in the
    dashboard. It holds no authority of its own.

    What it can do
      - poll the server for an armed action and display it
      - read a card UID and relay it with the server's own nonce
      - show the server's answer

    What it can never do
      - arm itself. The nonce comes from the server, issued only after
        an operator clicked Proceed. There is no local path to an armed
        state, no offline approval, no cached action.
      - decide. There is no allowlist on this device, no risk-tier
        logic, no state machine that could conclude a tap is valid. It
        asks and displays.
      - be trusted on its word. Every tap carries an HMAC over
        device_id|uid|nonce|ts using a per-device secret, so a reader
        the server does not know cannot submit anything.

    Why it is built this way: a device that could invent its own
    authority would be a way to launder an unapproved action into
    something that looks official. The same principle as the SAAKSHI
    job-card reader, applied to operational change instead of records.

    Honest limitation, stated on the screen and in the pitch: an RFID
    UID is a public identifier, not a secret, and "magic" cards can
    carry an arbitrary one. The tap is the SECOND factor after dashboard
    approval, scoped by a single-use nonce with a 60 s TTL. Production
    would use DESFire EV2/EV3 or NTAG 424 DNA with AES challenge-
    response, over TLS.

    Libraries
      LovyanGFX >= 1.1.16 - MFRC522 1.4.x - ArduinoJson >= 7.0
    Board: "ESP32S3 Dev Module"
    ===================================================================== */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <time.h>
#include "mbedtls/md.h"

#include "config.h"
#include "secrets.h"
#include "lgfx_setup.h"

#if __has_include("esp_arduino_version.h")
#include "esp_arduino_version.h"
#endif

static LGFX     tft;
static MFRC522  rfid(PIN_RFID_SS, PIN_RFID_RST);

// ---------------------------------------------------------------------
//  Palette - the console's light theme, carried onto the device so the
//  physical screen and the dashboard look like one product.
// ---------------------------------------------------------------------
static constexpr uint16_t C565(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}
static const uint16_t COL_CANVAS   = C565(245, 246, 248);  // --canvas
static const uint16_t COL_SURFACE  = C565(255, 255, 255);  // --surface
static const uint16_t COL_BORDER   = C565(218, 220, 224);  // --border
static const uint16_t COL_INK      = C565( 32,  33,  36);  // --ink
static const uint16_t COL_INK2     = C565( 95,  99, 104);  // --ink-2
static const uint16_t COL_MUTED    = C565(128, 134, 139);  // --ink-muted
static const uint16_t COL_PRIMARY  = C565( 21,  95, 166);  // --primary
static const uint16_t COL_OK       = C565( 30, 142,  62);  // --ok
static const uint16_t COL_WARN     = C565(199, 119,   0);  // --warn
static const uint16_t COL_CRIT     = C565(197,  34,  31);  // --crit
static const uint16_t COL_OK_WEAK  = C565(230, 244, 234);
static const uint16_t COL_CRIT_WEAK= C565(252, 232, 230);

static const int HEADER_H = 48;
static const int FOOTER_Y = 292;

// ---------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------
enum Screen { SCR_BOOT, SCR_NO_WIFI, SCR_IDLE, SCR_ARMED, SCR_BUSY, SCR_RESULT };

struct ArmedAction {
  bool     armed = false;
  String   proposalId, nonce, action, target, line1, line2, riskTier;
  uint32_t expiresInS = 0;       // as of lastPollMs
  uint32_t lastPollMs = 0;
};

struct ResultView {
  bool     ok = false;
  String   title, detail, actor, auditHash;
  uint32_t until = 0;
};

static Screen      screen        = SCR_BOOT;
static ArmedAction armed;
static ResultView  result;

static uint32_t tLastPoll      = 0;
static uint32_t tLastHeartbeat = 0;
static uint32_t tLastNtp       = 0;
static uint32_t tLastRedraw    = 0;
static bool     timeSynced     = false;
static bool     serverSeen     = false;
static String   lastUid;
static uint32_t lastUidAt      = 0;
static Screen   lastDrawn      = SCR_BOOT;
static int      lastCountdown  = -1;

// ---------------------------------------------------------------------
//  Status LED
// ---------------------------------------------------------------------
static void setRgb(uint8_t r, uint8_t g, uint8_t b) {
#if PIN_RGB_LED >= 0
  uint8_t rr = (uint16_t)r * RGB_BRIGHTNESS / 255;
  uint8_t gg = (uint16_t)g * RGB_BRIGHTNESS / 255;
  uint8_t bb = (uint16_t)b * RGB_BRIGHTNESS / 255;
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  rgbLedWrite(PIN_RGB_LED, rr, gg, bb);
#else
  neopixelWrite(PIN_RGB_LED, rr, gg, bb);
#endif
#else
  (void)r; (void)g; (void)b;
#endif
}

// ---------------------------------------------------------------------
//  HMAC-SHA256, hex
// ---------------------------------------------------------------------
static String hmacSha256Hex(const char* key, const String& msg) {
  byte out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mbedtls_md_setup(&ctx, info, 1) != 0) { mbedtls_md_free(&ctx); return String(); }
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);

  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]);
  hex[64] = '\0';
  return String(hex);
}

// ---------------------------------------------------------------------
//  Drawing helpers
// ---------------------------------------------------------------------
static void drawText(const String& s, int x, int y, const lgfx::IFont* f, uint16_t c) {
  tft.setFont(f); tft.setTextColor(c, COL_SURFACE); tft.drawString(s.c_str(), x, y);
}

static void drawHeader(const String& title, uint16_t accent) {
  tft.fillRect(0, 0, SCREEN_W, HEADER_H, COL_SURFACE);
  tft.fillRect(0, HEADER_H - 1, SCREEN_W, 1, COL_BORDER);
  tft.fillRect(0, 0, 4, HEADER_H, accent);
  drawText("RackSense", 16, 10, &fonts::FreeSansBold12pt7b, COL_INK);
  tft.setFont(&fonts::FreeSans9pt7b);
  tft.setTextColor(COL_INK2, COL_SURFACE);
  tft.drawString(title.c_str(), 16, 29);

  // connection dot, right aligned
  uint16_t dot = (WiFi.status() == WL_CONNECTED)
                 ? (serverSeen ? COL_OK : COL_WARN) : COL_CRIT;
  tft.fillCircle(SCREEN_W - 22, 24, 5, dot);
}

static void drawFooter(const String& left, const String& right) {
  tft.fillRect(0, FOOTER_Y, SCREEN_W, SCREEN_H - FOOTER_Y, COL_SURFACE);
  tft.fillRect(0, FOOTER_Y, SCREEN_W, 1, COL_BORDER);
  tft.setFont(&fonts::Font0);
  tft.setTextColor(COL_MUTED, COL_SURFACE);
  tft.drawString(left.c_str(), 12, FOOTER_Y + 10);
  if (right.length()) {
    int w = tft.textWidth(right.c_str());
    tft.drawString(right.c_str(), SCREEN_W - 12 - w, FOOTER_Y + 10);
  }
}

static void clearBody() {
  tft.fillRect(0, HEADER_H, SCREEN_W, FOOTER_Y - HEADER_H, COL_SURFACE);
}

// ---------------------------------------------------------------------
//  Screens
// ---------------------------------------------------------------------
static void drawBoot() {
  tft.fillScreen(COL_SURFACE);
  drawHeader("Authorization console", COL_PRIMARY);
  clearBody();
  drawText("Starting", 24, 120, &fonts::FreeSans12pt7b, COL_INK);
  drawText(String("Device ") + DEVICE_ID + "  firmware " + FW_VERSION,
           24, 152, &fonts::FreeSans9pt7b, COL_INK2);
  drawFooter("RackSense", "");
}

static void drawNoWifi() {
  tft.fillScreen(COL_SURFACE);
  drawHeader("Authorization console", COL_CRIT);
  clearBody();
  drawText("No network", 24, 110, &fonts::FreeSansBold12pt7b, COL_CRIT);
  drawText("This reader cannot authorize anything while offline.",
           24, 146, &fonts::FreeSans9pt7b, COL_INK2);
  drawText("It holds no cached approvals by design.",
           24, 168, &fonts::FreeSans9pt7b, COL_MUTED);
  drawFooter(String("Device ") + DEVICE_ID, "Reconnecting");
}

static void drawIdle() {
  tft.fillScreen(COL_SURFACE);
  drawHeader("Authorization console", COL_PRIMARY);
  clearBody();
  drawText("No action awaiting authorization", 24, 112,
           &fonts::FreeSansBold12pt7b, COL_INK);
  drawText("An operator must approve an action in the dashboard",
           24, 150, &fonts::FreeSans9pt7b, COL_INK2);
  drawText("before this reader will accept a card.",
           24, 172, &fonts::FreeSans9pt7b, COL_INK2);
  drawFooter(String("Device ") + DEVICE_ID,
             serverSeen ? "Server reachable" : "Waiting for server");
}

static void drawArmed(int secondsLeft) {
  tft.fillScreen(COL_SURFACE);
  uint16_t accent = (armed.riskTier == "HIGH") ? COL_CRIT
                  : (armed.riskTier == "MEDIUM") ? COL_WARN : COL_PRIMARY;
  drawHeader("Awaiting authorization", accent);
  clearBody();

  // The action, exactly as the server rendered it. The device composes
  // no meaning of its own - the dashboard and this screen must say the
  // same words, and the operator can check that they do.
  drawText(armed.line1, 24, 72, &fonts::FreeSansBold18pt7b, COL_INK);
  drawText(armed.line2, 24, 112, &fonts::FreeSans12pt7b, COL_INK2);

  // risk chip
  tft.drawRoundRect(24, 146, 104, 24, 4, accent);
  tft.setFont(&fonts::Font0);
  tft.setTextColor(accent, COL_SURFACE);
  tft.drawString((String("RISK ") + armed.riskTier).c_str(), 34, 154);

  tft.setFont(&fonts::Font0);
  tft.setTextColor(COL_MUTED, COL_SURFACE);
  tft.drawString(armed.proposalId.c_str(), 144, 154);

  drawText("Tap your card to authorize", 24, 192, &fonts::FreeSans12pt7b, COL_INK);

  // countdown
  char cd[16];
  snprintf(cd, sizeof(cd), "%ds", secondsLeft < 0 ? 0 : secondsLeft);
  tft.setFont(&fonts::FreeSansBold18pt7b);
  tft.setTextColor(accent, COL_SURFACE);
  int w = tft.textWidth(cd);
  tft.drawString(cd, SCREEN_W - 28 - w, 186);

  drawFooter("Approved in dashboard - tap confirms", "Window closes");
}

static void drawBusy() {
  clearBody();
  drawText("Checking with server", 24, 130, &fonts::FreeSans12pt7b, COL_INK);
  drawFooter(String("Device ") + DEVICE_ID, "");
}

static void drawResult() {
  tft.fillScreen(COL_SURFACE);
  uint16_t accent = result.ok ? COL_OK : COL_CRIT;
  drawHeader(result.ok ? "Authorized" : "Not authorized", accent);
  clearBody();

  tft.fillRoundRect(16, 62, SCREEN_W - 32, 56, 6,
                    result.ok ? COL_OK_WEAK : COL_CRIT_WEAK);
  tft.setFont(&fonts::FreeSansBold18pt7b);
  tft.setTextColor(accent, result.ok ? COL_OK_WEAK : COL_CRIT_WEAK);
  tft.drawString(result.title.c_str(), 32, 76);

  drawText(result.detail, 24, 134, &fonts::FreeSans9pt7b, COL_INK2);
  if (result.actor.length())
    drawText(String("Authorized by ") + result.actor, 24, 158,
             &fonts::FreeSans9pt7b, COL_INK);

  if (result.auditHash.length()) {
    drawText("Audit head", 24, 196, &fonts::Font0, COL_MUTED);
    // The same hash the dashboard shows. Printing it here is what makes
    // the chain checkable in public rather than a claim in a slide.
    drawText(result.auditHash.substring(0, 32), 24, 212,
             &fonts::Font0, COL_INK);
  }
  drawFooter(String("Device ") + DEVICE_ID, "");
}

// ---------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------
static String apiUrl(const char* suffix) {
  return String("http://") + API_HOST + ":" + String(API_PORT) + API_BASE_PATH + suffix;
}

static void pollPending() {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(apiUrl("/pending"))) return;

  int code = http.GET();
  if (code != 200) {
    http.end();
    if (code <= 0) serverSeen = false;
    return;
  }
  serverSeen = true;

  StaticJsonDocument<768> doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return;

  bool isArmed = doc["armed"] | false;
  if (!isArmed) {
    if (armed.armed) { armed = ArmedAction(); }   // window closed server-side
    return;
  }

  armed.armed      = true;
  armed.proposalId = (const char*)(doc["proposal_id"] | "");
  armed.nonce      = (const char*)(doc["nonce"]       | "");
  armed.action     = (const char*)(doc["action"]      | "");
  armed.target     = (const char*)(doc["target"]      | "");
  armed.line1      = (const char*)(doc["line1"]       | "");
  armed.line2      = (const char*)(doc["line2"]       | "");
  armed.riskTier   = (const char*)(doc["risk_tier"]   | "LOW");
  armed.expiresInS = doc["expires_in_s"] | 0;
  armed.lastPollMs = millis();
}

static int secondsLeft() {
  if (!armed.armed) return 0;
  uint32_t elapsed = (millis() - armed.lastPollMs) / 1000UL;
  int left = (int)armed.expiresInS - (int)elapsed;
  return left < 0 ? 0 : left;
}

static void submitTap(const String& uid) {
  screen = SCR_BUSY;
  drawBusy();
  setRgb(0, 0, 60);

  uint32_t ts = timeSynced ? (uint32_t)time(nullptr) : 0;
  if (ts == 0) {
    result.ok = false;
    result.title = "No clock";
    result.detail = "The reader has no synced time, so it cannot sign a tap.";
    result.actor = ""; result.auditHash = "";
    result.until = millis() + RESULT_DWELL_MS;
    screen = SCR_RESULT;
    drawResult();
    setRgb(60, 0, 0);
    return;
  }

  // The signed message binds the device, the card, the server's nonce
  // and the time together. Replaying any one of them alone fails.
  String msg = String(DEVICE_ID) + "|" + uid + "|" + armed.nonce + "|" + String(ts);
  String mac = hmacSha256Hex(DEVICE_HMAC_SECRET, msg);

  StaticJsonDocument<384> body;
  body["uid"]   = uid;
  body["nonce"] = armed.nonce;
  body["ts"]    = ts;
  body["hmac"]  = mac;

  String payload;
  serializeJson(body, payload);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(apiUrl("/tap"))) {
    result.ok = false;
    result.title = "No server";
    result.detail = "Could not reach the server. Nothing was authorized.";
    result.actor = ""; result.auditHash = "";
    result.until = millis() + RESULT_DWELL_MS;
    screen = SCR_RESULT;
    drawResult();
    setRgb(60, 0, 0);
    return;
  }
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  String resp = (code > 0) ? http.getString() : String();
  http.end();

  result.actor = "";
  result.auditHash = "";

  if (code <= 0) {
    serverSeen = false;
    result.ok = false;
    result.title = "No answer";
    result.detail = "The server did not respond. Nothing was authorized.";
  } else {
    StaticJsonDocument<768> doc;
    if (deserializeJson(doc, resp)) {
      result.ok = false;
      result.title = "Bad response";
      result.detail = "The server's reply could not be read.";
    } else if (doc.containsKey("error")) {
      result.ok = false;
      result.title = "Rejected";
      result.detail = (const char*)(doc["error"]["message"] | "Rejected by server");
    } else {
      const char* r = doc["result"] | "";
      if (strcmp(r, "AUTHORIZED") == 0) {
        result.ok        = true;
        result.title     = "Authorized";
        result.detail    = armed.line1 + String(" - ") + armed.line2;
        result.actor     = (const char*)(doc["actor"] | "");
        result.auditHash = (const char*)(doc["audit_hash"] | "");
      } else {
        result.ok     = false;
        result.title  = "Rejected";
        result.detail = (const char*)(doc["message"] | "Not authorized");
      }
    }
  }

  // Whatever happened, this device's copy of the armed action is stale
  // now. Drop it and let the next poll tell us the truth.
  armed = ArmedAction();

  result.until = millis() + RESULT_DWELL_MS;
  screen = SCR_RESULT;
  drawResult();
  setRgb(result.ok ? 0 : 60, result.ok ? 60 : 0, 0);
}

static void sendHeartbeat() {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(apiUrl("/heartbeat"))) return;
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<192> doc;
  doc["fw"]       = FW_VERSION;
  doc["rssi"]     = WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000UL;

  String payload;
  serializeJson(doc, payload);
  int code = http.POST(payload);
  if (code == 200) serverSeen = true;
  http.end();
}

// ---------------------------------------------------------------------
//  RFID
// ---------------------------------------------------------------------
static String readCardUid() {
  if (!rfid.PICC_IsNewCardPresent()) return String();
  if (!rfid.PICC_ReadCardSerial())   return String();

  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return uid;
}

// ---------------------------------------------------------------------
//  Setup
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(50);

  tft.init();
  tft.setRotation(1);               // landscape 480x320
  tft.setBrightness(180);
  drawBoot();
  setRgb(0, 0, 40);

  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_RFID_SS);
  rfid.PCD_Init();
  delay(20);
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("{\"event\":\"rc522_version\",\"value\":\"0x%02X\"}\n", v);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(TZ_OFFSET_SEC, 0, NTP_SERVER_1, NTP_SERVER_2);

  Serial.printf("{\"event\":\"boot\",\"device\":\"%s\",\"fw\":\"%s\"}\n",
                DEVICE_ID, FW_VERSION);
}

// ---------------------------------------------------------------------
//  Loop - non-blocking throughout
// ---------------------------------------------------------------------
void loop() {
  uint32_t now = millis();

  // --- time
  if (!timeSynced) {
    time_t t = time(nullptr);
    if (t > 1700000000) { timeSynced = true; tLastNtp = now; }
  } else if (now - tLastNtp >= NTP_RESYNC_PERIOD_MS) {
    tLastNtp = now;
    configTime(TZ_OFFSET_SEC, 0, NTP_SERVER_1, NTP_SERVER_2);
  }

  bool online = (WiFi.status() == WL_CONNECTED);

  // --- poll for an armed action
  if (online && now - tLastPoll >= POLL_PERIOD_MS) {
    tLastPoll = now;
    pollPending();
  }

  // --- heartbeat
  if (online && now - tLastHeartbeat >= HEARTBEAT_PERIOD_MS) {
    tLastHeartbeat = now;
    sendHeartbeat();
  }

  // --- decide which screen we are on
  Screen want;
  if (screen == SCR_RESULT && now < result.until) {
    want = SCR_RESULT;
  } else if (!online) {
    want = SCR_NO_WIFI;
  } else if (armed.armed && secondsLeft() > 0) {
    want = SCR_ARMED;
  } else {
    if (armed.armed && secondsLeft() <= 0) armed = ArmedAction();
    want = SCR_IDLE;
  }

  // --- redraw only on change (full repaints on an SPI panel are slow)
  int cd = (want == SCR_ARMED) ? secondsLeft() : -1;
  if (want != lastDrawn || (want == SCR_ARMED && cd != lastCountdown)) {
    switch (want) {
      case SCR_NO_WIFI: drawNoWifi();  setRgb(60, 0, 0);  break;
      case SCR_IDLE:    drawIdle();    setRgb(0, 20, 0);  break;
      case SCR_ARMED:   drawArmed(cd); setRgb(60, 40, 0); break;
      case SCR_RESULT:  /* already drawn by submitTap */   break;
      default:          drawBoot();                        break;
    }
    lastDrawn     = want;
    lastCountdown = cd;
    screen        = want;
  }

  // --- cards
  String uid = readCardUid();
  if (uid.length()) {
    bool repeat = (uid == lastUid) && (now - lastUidAt < UID_REPEAT_LOCKOUT_MS);
    lastUid = uid; lastUidAt = now;

    if (!repeat) {
      if (want == SCR_ARMED) {
        submitTap(uid);
        lastDrawn = SCR_RESULT;
      } else {
        // A card presented with nothing armed is not an error worth a
        // screen takeover. Say so briefly and return to idle.
        result.ok     = false;
        result.title  = "Nothing to authorize";
        result.detail = "No action is awaiting authorization right now.";
        result.actor  = ""; result.auditHash = "";
        result.until  = now + 2500;
        screen = SCR_RESULT;
        drawResult();
        lastDrawn = SCR_RESULT;
        setRgb(40, 40, 0);
      }
    }
  }
}
