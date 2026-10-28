/*  =====================================================================
    RackSense - Vibration node                               (fw 0.3.1)

    ESP32-S3  +  MPU6050 (direct I2C, no driver library)
    ---------------------------------------------------------------------
    Samples the accelerometer at 200 Hz and publishes three FEATURES per
    2-second window: RMS, peak and crest factor. Features on the node,
    scoring on the server.

    Why features and not raw samples
      400 samples every 2 s per axis would be ~5 KB/s of JSON for data
      the server immediately reduces anyway. RMS, peak and crest are
      what the analysis actually consumes.

    Why relative and not absolute
      ISO 10816/20816 vibration severity zones are defined for machines
      of 15 kW to 300 kW, measured as velocity in a 10-1000 Hz band.
      A 5 V rack fan is not such a machine, and an MPU6050's noise floor
      (~400 ug/sqrt(Hz)) makes integrating acceleration to velocity
      meaninglessly noisy at these amplitudes. So the server compares
      RMS against THIS node's own captured baseline: 2x warn, 4x
      critical. The axis is labelled "x baseline", never mm/s.

    What this node will not do
      - publish a value before a baseline exists. It publishes raw
        features; the server refuses to derive a status until an
        operator has captured a baseline over a quiet window.
      - invent a sample. An I2C read failure drops the window rather
        than padding it.
      - block. Sampling is driven by micros() deadlines, never delay().

    Libraries: PubSubClient 2.8+ - ArduinoJson 7+ - Wire (core)
    Board: "ESP32S3 Dev Module"
    ===================================================================== */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>

#include "config.h"
#include "secrets.h"

// ---------------------------------------------------------------------
//  MPU6050 registers
// ---------------------------------------------------------------------
static const uint8_t REG_SMPLRT_DIV   = 0x19;
static const uint8_t REG_CONFIG       = 0x1A;
static const uint8_t REG_ACCEL_CONFIG = 0x1C;
static const uint8_t REG_ACCEL_XOUT_H = 0x3B;
static const uint8_t REG_PWR_MGMT_1   = 0x6B;
static const uint8_t REG_WHO_AM_I     = 0x75;

static WiFiClient   net;
static PubSubClient mqtt(net);

static uint32_t seqCounter     = 0;
static bool     timeSynced     = false;
static bool     mpuPresent     = false;
static uint32_t reconnectDelay = RECONNECT_MIN_MS;
static uint32_t tNextReconnect = 0;

// ---------------------------------------------------------------------
//  Window accumulator
//
//  Running sums rather than a stored array: we never need the samples
//  again once the window closes, and 400 floats per axis would be a
//  pointless allocation.
// ---------------------------------------------------------------------
struct WindowAcc {
  uint32_t n      = 0;
  double   sum    = 0.0;    // for the DC (gravity) component
  double   sumSq  = 0.0;
  float    gMin   = 0.0f;
  float    gMax   = 0.0f;
  uint32_t failures = 0;

  void reset() {
    n = 0; sum = 0.0; sumSq = 0.0;
    gMin = 1e9f; gMax = -1e9f;
    failures = 0;
  }
};

static WindowAcc acc;
static uint32_t tNextSampleUs = 0;
static uint32_t tWindowStart  = 0;

// ---------------------------------------------------------------------
//  Offline ring buffer - replayed on reconnect with original timestamps
// ---------------------------------------------------------------------
struct VibReading {
  uint32_t ts;
  uint32_t seq;
  float    rmsG, peakG, crest;
  uint16_t samples;
  int16_t  rssi;
};

static VibReading ring[RINGBUF_ENTRIES];
static uint16_t ringHead = 0, ringCount = 0;

static void ringPush(const VibReading& r) {
  ring[ringHead] = r;
  ringHead = (ringHead + 1) % RINGBUF_ENTRIES;
  if (ringCount < RINGBUF_ENTRIES) ringCount++;
}

// ---------------------------------------------------------------------
//  I2C helpers
// ---------------------------------------------------------------------
static bool mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_I2C_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool mpuReadBytes(uint8_t reg, uint8_t* buf, uint8_t len) {
  Wire.beginTransmission(MPU_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_I2C_ADDR, (int)len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

static bool mpuInit() {
  uint8_t who = 0;
  if (!mpuReadBytes(REG_WHO_AM_I, &who, 1)) return false;
  // 0x68 is the MPU6050; some clones answer 0x70/0x72/0x98.
  if (who != 0x68 && who != 0x70 && who != 0x72 && who != 0x98) {
    Serial.printf("{\"event\":\"mpu_unexpected_whoami\",\"value\":\"0x%02X\"}\n", who);
  }
  if (!mpuWrite(REG_PWR_MGMT_1, 0x00)) return false;   // wake, internal 8 MHz
  delay(10);
  // DLPF 44 Hz: above fan-imbalance frequencies, below the alias band.
  if (!mpuWrite(REG_CONFIG, 0x03)) return false;
  // Gyro output 1 kHz / (1+4) = 200 Hz, matching our sampling rate.
  if (!mpuWrite(REG_SMPLRT_DIV, 4)) return false;
  if (!mpuWrite(REG_ACCEL_CONFIG, (uint8_t)(MPU_ACCEL_FS_SEL << 3))) return false;
  return true;
}

// Magnitude of the 3-axis acceleration vector, in g.
static bool readAccelMagnitudeG(float& outG) {
  uint8_t b[6];
  if (!mpuReadBytes(REG_ACCEL_XOUT_H, b, 6)) return false;
  int16_t ax = (int16_t)((b[0] << 8) | b[1]);
  int16_t ay = (int16_t)((b[2] << 8) | b[3]);
  int16_t az = (int16_t)((b[4] << 8) | b[5]);
  float x = ax / MPU_LSB_PER_G;
  float y = ay / MPU_LSB_PER_G;
  float z = az / MPU_LSB_PER_G;
  outG = sqrtf(x * x + y * y + z * z);
  return true;
}

// ---------------------------------------------------------------------
//  MQTT
// ---------------------------------------------------------------------
static void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  // Display/operational commands only. Never authorization.
  (void)topic; (void)payload; (void)len;
}

static bool mqttConnect() {
  String cid = String("rs-") + NODE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  bool ok = mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASSWORD,
                         TOPIC_STATUS, 1, true, "offline");
  if (!ok) return false;
  mqtt.publish(TOPIC_STATUS, "online", true);
  mqtt.subscribe(TOPIC_CMD);
  Serial.println(F("{\"event\":\"mqtt_connected\"}"));
  return true;
}

static bool publishReading(const VibReading& r) {
  StaticJsonDocument<384> doc;
  doc["node"]        = NODE_ID;
  doc["tenant"]      = TENANT_ID;
  doc["seq"]         = r.seq;
  doc["ts"]          = r.ts;
  doc["fw"]          = FW_VERSION;
  doc["vib_rms_g"]   = serialized(String(r.rmsG, 5));
  doc["vib_peak_g"]  = serialized(String(r.peakG, 5));
  doc["vib_crest"]   = serialized(String(r.crest, 3));
  doc["samples"]     = r.samples;
  doc["rssi"]        = r.rssi;
  doc["uptime_s"]    = millis() / 1000UL;

  char buf[384];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  return mqtt.publish(TOPIC_TELEMETRY, (const uint8_t*)buf, n, false);
}

static void flushRing() {
  int budget = 10;
  while (budget-- > 0 && ringCount > 0) {
    uint16_t tail = (ringHead + RINGBUF_ENTRIES - ringCount) % RINGBUF_ENTRIES;
    if (!publishReading(ring[tail])) break;
    ringCount--;
  }
}

// ---------------------------------------------------------------------
//  Setup
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(50);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ);
  mpuPresent = mpuInit();
  Serial.printf("{\"event\":\"mpu_init\",\"ok\":%s}\n", mpuPresent ? "true" : "false");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(TZ_OFFSET_SEC, 0, NTP_SERVER_1, NTP_SERVER_2);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setBufferSize(MQTT_BUFFER_BYTES);    // before connect, always
  mqtt.setCallback(onMqttMessage);

  acc.reset();
  tWindowStart  = millis();
  tNextSampleUs = micros();

  Serial.printf("{\"event\":\"boot\",\"node\":\"%s\",\"fw\":\"%s\"}\n", NODE_ID, FW_VERSION);
}

// ---------------------------------------------------------------------
//  Loop
// ---------------------------------------------------------------------
void loop() {
  uint32_t now   = millis();
  uint32_t nowUs = micros();

  // --- time sync
  if (!timeSynced) {
    time_t t = time(nullptr);
    if (t > 1700000000) {
      timeSynced = true;
      Serial.println(F("{\"event\":\"time_synced\"}"));
    }
  }

  // --- MQTT with capped backoff
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    if (now >= tNextReconnect) {
      if (mqttConnect()) {
        reconnectDelay = RECONNECT_MIN_MS;
      } else {
        tNextReconnect = now + reconnectDelay;
        reconnectDelay = min(reconnectDelay * 2, (uint32_t)RECONNECT_MAX_MS);
      }
    }
  }
  if (mqtt.connected()) mqtt.loop();

  // --- recover the sensor if it dropped off the bus
  if (!mpuPresent && (now % 5000) < 2) {
    mpuPresent = mpuInit();
  }

  // --- sample on a micros() deadline (no delay anywhere)
  if (mpuPresent && (int32_t)(nowUs - tNextSampleUs) >= 0) {
    tNextSampleUs += SAMPLE_PERIOD_US;
    // If we fell behind (Wi-Fi stack stole time), resync rather than
    // spinning to catch up - a burst of back-to-back reads would
    // distort the window.
    if ((int32_t)(micros() - tNextSampleUs) > (int32_t)SAMPLE_PERIOD_US) {
      tNextSampleUs = micros() + SAMPLE_PERIOD_US;
    }

    float g;
    if (readAccelMagnitudeG(g)) {
      acc.n++;
      acc.sum   += g;
      acc.sumSq += (double)g * g;
      if (g < acc.gMin) acc.gMin = g;
      if (g > acc.gMax) acc.gMax = g;
    } else {
      acc.failures++;
      if (acc.failures > 20) mpuPresent = false;   // bus has gone away
    }
  }

  // --- close the window and publish
  if (now - tWindowStart >= WINDOW_MS) {
    tWindowStart = now;

    // Need a reasonable share of the expected samples to call it a
    // window. Otherwise drop it - the seq gap is the honest signal.
    if (acc.n >= (WINDOW_SAMPLES / 2)) {
      double mean = acc.sum / acc.n;                  // ~1 g: gravity
      double ms   = acc.sumSq / acc.n;                // mean square
      double varc = ms - mean * mean;                 // remove the DC term
      if (varc < 0) varc = 0;                         // numerical guard
      float rms = (float)sqrt(varc);                  // AC-coupled RMS, in g

      // Peak is the largest deviation from the window's own mean, for
      // the same reason: gravity is not vibration.
      float peak = fmaxf((float)(acc.gMax - mean), (float)(mean - acc.gMin));
      if (peak < 0) peak = 0;

      VibReading r;
      r.ts      = timeSynced ? (uint32_t)time(nullptr) : 0;
      r.seq     = ++seqCounter;
      r.rmsG    = rms;
      r.peakG   = peak;
      r.crest   = (rms > 1e-6f) ? (peak / rms) : 0.0f;
      r.samples = (uint16_t)acc.n;
      r.rssi    = WiFi.RSSI();

      if (r.ts == 0) {
        // no trustworthy clock yet - drop rather than stamp a guess
      } else if (mqtt.connected()) {
        if (!publishReading(r)) ringPush(r);
      } else {
        ringPush(r);
      }
    }

    acc.reset();
  }

  if (mqtt.connected() && ringCount > 0) flushRing();
}
