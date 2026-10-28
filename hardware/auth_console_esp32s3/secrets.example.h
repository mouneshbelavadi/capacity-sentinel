// =====================================================================
//  RackSense - secrets.example.h  (authorization console)
//
//  Copy to secrets.h and fill in. secrets.h is gitignored and must
//  NEVER be committed.
//
//  DEVICE_HMAC_SECRET must match reader_devices.secret_hash on the
//  server for this DEVICE_ID. It is what stops an unregistered reader
//  from submitting taps. Generate a long random value; do not reuse it
//  across devices.
// =====================================================================
#pragma once

#define WIFI_SSID            "your-ssid"
#define WIFI_PASSWORD        "your-wifi-password"

// The Arduino UNO Q running FastAPI.
#define API_HOST             "192.168.1.50"

// Per-device shared secret. 32+ random characters.
#define DEVICE_HMAC_SECRET   "replace-with-a-long-random-per-device-secret"
