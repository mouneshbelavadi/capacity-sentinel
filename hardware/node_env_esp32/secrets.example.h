// =====================================================================
//  RackSense - secrets.example.h
//
//  Copy to secrets.h and fill in. secrets.h is gitignored and must
//  NEVER be committed.
// =====================================================================
#pragma once

#define WIFI_SSID        "your-ssid"
#define WIFI_PASSWORD    "your-wifi-password"

// The Arduino UNO Q running Mosquitto + FastAPI.
// Use a static IP or a reserved DHCP lease - the firmware points here.
#define MQTT_HOST        "192.168.1.50"

// Per-node broker credentials (one username per node, not a shared one).
#define MQTT_USER        "node-r1-n1"
#define MQTT_PASSWORD    "change-me"
