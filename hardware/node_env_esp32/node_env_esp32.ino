/*  =====================================================================
    RackSense - Environment node                              (fw 0.3.1)

    ESP32 Dev Module  +  DHT22  +  MQ135  +  SW-420
    ---------------------------------------------------------------------
    Publishes inlet temperature, humidity, dew point, an air-quality
    RATIO and a shock count to MQTT every 2 seconds.

    What this node will not do
      - report MQ135 ppm. The sensor is broadly cross-sensitive and
        strongly temperature/humidity dependent; a ppm figure from it
        would be a number with no justification behind it. We publish
        Rs/R0 against a clean-air baseline and nothing else.
      - publish an air-quality value before preheat is complete. The
        datasheet says "over 24 hours". Until then mq_warm is false and
        the field is omitted entirely, so the server reports
        SENSOR_WARMING_UP rather than showing a figure.
      - invent a reading. If the DHT22 read fails, the field is omitted.
        A dropped field is honest; a stale or interpolated one is not.
      - block. No delay() in loop(), no while(!connected). A node that
        blocks stops sampling, and a gap in the series is a gap in the
        forecast.

    Libraries
      PubSubClient 2.8+   - ArduinoJson 7+   - Adafruit DHT 1.4+
      Adafruit Unified Sensor   - Preferences (core)
    Board: "ESP32 Dev Module"
    ===================================================================== */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Preferences.h>
#include <time.h>

#include "config.h"
#include "secrets.h"

// ---------------------------------------------------------------------
//  Globals
// ---------------------------------------------------------------------
static WiFiClient   net;
static PubSubClient mqtt(net);
static DHT          dht(PIN_DHT22, DHT22);
static Preferences  prefs;

static uint32_t seqCounter      = 0;
static uint32_t firstBootEpoch  = 0;      // persisted; drives preheat tracking
static float    mqR0            = 0.0f;   // persisted clean-air baseline
static bool     mqR0Valid       = false;

// Latest sensor state. NAN means "no valid reading" and the field is omitted.
static float lastTempC = NAN;
static float lastRh    = NAN;
static float lastMqRs  = NAN;

static volatile uint32_t shockEdges   = 0;   // ISR-incremented
static volatile uint32_t lastShockUs  = 0;

static uint32_t tLastTelemetry = 0;
static uint32_t tLastDht       = 0;
static uint32_t tLastMq        = 0;
static uint32_t reconnectDelay = RECONNECT_MIN_MS;
static uint32_t tNextReconnect = 0;
static bool     timeSynced     = false;

// ---------------------------------------------------------------------
//  Offline ring buffer
//
//  Readings taken while the broker is unreachable. Replayed on
//  reconnect with their ORIGINAL timestamps so the server can mark them
//  backfilled instead of mistaking them for a burst of live data.
// ---------------------------------------------------------------------
struct Reading {
  uint32_t ts;
  uint32_t seq;
  float    tC, rh, dewC, mqRatio;
  bool     mqWarm;
  uint16_t shocks;
  int16_t  rssi;
};

static Reading ring[RINGBUF_ENTRIES];
static uint16_t ringHead = 0, ringCount = 0;

static void ringPush(const Reading& r) {
  ring[ringHead] = r;
  ringHead = (ringHead + 1) % RINGBUF_ENTRIES;
  if (ringCount < RINGBUF_ENTRIES) ringCount++;
}

static bool ringPop(Reading& out) {
  if (ringCount == 0) return false;
  uint16_t tail = (ringHead + RINGBUF_ENTRIES - ringCount) % RINGBUF_ENTRIES;
  out = ring[tail];
  ringCount--;
  return true;
}

// ---------------------------------------------------------------------
//  Shock ISR - SW-420 is a spring switch behind a comparator. It gives
//  a binary edge, not an amplitude, so all we can honestly report is a
//  debounced event count.
// ---------------------------------------------------------------------
static void IRAM_ATTR onShockEdge() {
  uint32_t now = micros();
  if (now - lastShockUs > (SHOCK_DEBOUNCE_MS * 1000UL)) {
    lastShockUs = now;
    shockEdges++;
  }
}

// ---------------------------------------------------------------------
//  Dew point - Magnus formula. Derived from two measurements of the
//  same air, so it stays quality "measured" at the server.
// ---------------------------------------------------------------------
static float dewPointC(float tC, float rh) {
  if (isnan(tC) || isnan(rh) || rh <= 0.0f) return NAN;
  const float a = 17.62f, b = 243.12f;
  float gamma = (a * tC) / (b + tC) + logf(rh / 100.0f);
  return (b * gamma) / (a - gamma);
}

// ---------------------------------------------------------------------
//  MQ135 - resistance, not ppm
// ---------------------------------------------------------------------
static float readMqRs() {
  // analogReadMilliVolts applies the per-chip ADC calibration, which the
  // raw 0-4095 count does not.
  uint32_t mvAdc = analogReadMilliVolts(PIN_MQ135_AO);
  float vSensor  = (float)mvAdc * MQ135_DIVIDER_RATIO;      // undo the 2:1 divider
  if (vSensor < 1.0f || vSensor >= MQ135_VCC_MV) return NAN; // open or shorted
  return MQ135_RL_OHMS * (MQ135_VCC_MV - vSensor) / vSensor;
}

static bool mqPreheatComplete() {
  if (!timeSynced || firstBootEpoch == 0) return false;
  uint32_t now = (uint32_t)time(nullptr);
  return (now > firstBootEpoch) &&
         ((now - firstBootEpoch) >= MQ135_PREHEAT_SECONDS);
}

// Clean-air calibration. Call only in known-clean air, after preheat.
// Triggered by a retained message on the cmd topic - never on its own,
// because a baseline captured in dirty air silently corrupts every
// later ratio.
static void calibrateMqR0() {
  const int N = 64;
  float sum = 0; int ok = 0;
  for (int i = 0; i < N; i++) {
    float rs = readMqRs();
    if (!isnan(rs)) { sum += rs; ok++; }
    delayMicroseconds(2000);
  }
  if (ok < N / 2) {
    Serial.println(F("{\"event\":\"mq_calibration_failed\",\"reason\":\"too few valid samples\"}"));
    return;
  }
  mqR0 = sum / ok;
  mqR0Valid = true;
  prefs.begin("racksense", false);
  prefs.putFloat("mq_r0", mqR0);
  prefs.end();
  Serial.printf("{\"event\":\"mq_calibrated\",\"r0_ohms\":%.1f,\"samples\":%d}\n", mqR0, ok);
}

// ---------------------------------------------------------------------
//  MQTT
// ---------------------------------------------------------------------
static void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  // The cmd topic carries operational commands only. It can never carry
  // authorization of anything - authorization does not travel on a bus
  // that other devices can publish to.
  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload, len)) return;
  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "calibrate_mq_r0") == 0) {
    if (mqPreheatComplete()) calibrateMqR0();
    else Serial.println(F("{\"event\":\"mq_calibration_refused\",\"reason\":\"preheat incomplete\"}"));
  }
}

static bool mqttConnect() {
  String cid = String("rs-") + NODE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);

  // Last Will: if this node drops off, the broker publishes "offline"
  // for us. That is what gives the server free, truthful presence
  // detection instead of a timeout guess.
  bool ok = mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASSWORD,
                         TOPIC_STATUS, 1, true, "offline");
  if (!ok) return false;

  mqtt.publish(TOPIC_STATUS, "online", true);
  mqtt.subscribe(TOPIC_CMD);
  Serial.println(F("{\"event\":\"mqtt_connected\"}"));
  return true;
}

static bool publishReading(const Reading& r) {
  StaticJsonDocument<512> doc;
  doc["node"]     = NODE_ID;
  doc["tenant"]   = TENANT_ID;
  doc["seq"]      = r.seq;
  doc["ts"]       = r.ts;
  doc["fw"]       = FW_VERSION;

  // Omit any field we do not have. An absent field is honest; a
  // substituted default would be fabricated data.
  if (!isnan(r.tC))   doc["t_c"]   = serialized(String(r.tC, 2));
  if (!isnan(r.rh))   doc["rh"]    = serialized(String(r.rh, 1));
  if (!isnan(r.dewC)) doc["dew_c"] = serialized(String(r.dewC, 2));

  doc["mq_warm"] = r.mqWarm;
  if (r.mqWarm && !isnan(r.mqRatio)) doc["mq_ratio"] = serialized(String(r.mqRatio, 3));

  doc["shock_count"] = r.shocks;
  doc["rssi"]        = r.rssi;
  doc["uptime_s"]    = millis() / 1000UL;

  char buf[512];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  return mqtt.publish(TOPIC_TELEMETRY, (const uint8_t*)buf, n, false);
}

static void flushRing() {
  Reading r;
  int budget = 10;                 // a few per loop; never a blocking burst
  while (budget-- > 0 && ringCount > 0) {
    uint16_t tail = (ringHead + RINGBUF_ENTRIES - ringCount) % RINGBUF_ENTRIES;
    if (!publishReading(ring[tail])) break;   // broker pushed back; try later
    ringPop(r);
  }
}

// ---------------------------------------------------------------------
//  Setup
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(50);

  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_SW420_DO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_SW420_DO), onShockEdge, FALLING);

  analogSetPinAttenuation(PIN_MQ135_AO, ADC_11db);   // full ~0-3.3 V span
  dht.begin();

  prefs.begin("racksense", false);
  mqR0           = prefs.getFloat("mq_r0", 0.0f);
  firstBootEpoch = prefs.getUInt("first_boot", 0);
  prefs.end();
  mqR0Valid = (mqR0 > 0.0f);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  configTime(TZ_OFFSET_SEC, 0, NTP_SERVER_1, NTP_SERVER_2);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setBufferSize(MQTT_BUFFER_BYTES);   // before connect, always
  mqtt.setCallback(onMqttMessage);

  Serial.printf("{\"event\":\"boot\",\"node\":\"%s\",\"fw\":\"%s\"}\n", NODE_ID, FW_VERSION);
}

// ---------------------------------------------------------------------
//  Loop - non-blocking throughout
// ---------------------------------------------------------------------
void loop() {
  uint32_t now = millis();

  // --- time sync, and the first-boot epoch that preheat is measured from
  if (!timeSynced) {
    time_t t = time(nullptr);
    if (t > 1700000000) {                       // plausibly real wall clock
      timeSynced = true;
      if (firstBootEpoch == 0) {
        firstBootEpoch = (uint32_t)t;
        prefs.begin("racksense", false);
        prefs.putUInt("first_boot", firstBootEpoch);
        prefs.end();
      }
      Serial.println(F("{\"event\":\"time_synced\"}"));
    }
  }

  // --- MQTT connection, with capped exponential backoff
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

  // --- DHT22: never faster than one read per 2 s
  if (now - tLastDht >= DHT_MIN_PERIOD_MS) {
    tLastDht = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    lastTempC = isnan(t) ? NAN : t;   // a failed read clears the value
    lastRh    = isnan(h) ? NAN : h;   // rather than keeping a stale one
  }

  // --- MQ135 resistance
  if (now - tLastMq >= MQ_SAMPLE_PERIOD_MS) {
    tLastMq = now;
    lastMqRs = readMqRs();
  }

  // --- publish window
  if (now - tLastTelemetry >= TELEMETRY_PERIOD_MS) {
    tLastTelemetry = now;

    noInterrupts();
    uint32_t shocks = shockEdges;
    shockEdges = 0;
    interrupts();

    bool warm = mqPreheatComplete() && mqR0Valid;

    Reading r;
    r.ts      = timeSynced ? (uint32_t)time(nullptr) : 0;
    r.seq     = ++seqCounter;
    r.tC      = lastTempC;
    r.rh      = lastRh;
    r.dewC    = dewPointC(lastTempC, lastRh);
    r.mqRatio = (warm && !isnan(lastMqRs)) ? (lastMqRs / mqR0) : NAN;
    r.mqWarm  = warm;
    r.shocks  = (uint16_t)min(shocks, (uint32_t)65535);
    r.rssi    = WiFi.RSSI();

    // Without a real clock the timestamp would be a guess, so we hold
    // the reading rather than stamping it with something invented.
    if (r.ts == 0) {
      // drop silently; the seq gap tells the server a sample was lost
    } else if (mqtt.connected()) {
      if (!publishReading(r)) ringPush(r);
    } else {
      ringPush(r);
    }

    digitalWrite(PIN_STATUS_LED, mqtt.connected() ? HIGH : LOW);
  }

  // --- replay anything buffered while offline
  if (mqtt.connected() && ringCount > 0) flushRing();
}
