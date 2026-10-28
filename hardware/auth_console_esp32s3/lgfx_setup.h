// =====================================================================
//  RackSense - LovyanGFX panel definition for the 3.5" ILI9488
//  480x320, SPI, sharing the bus with the RC522.
//
//  Pins come from config.h. Do not put pin numbers in this file.
// =====================================================================
#pragma once

#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include "config.h"

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9488 _panel;
  lgfx::Bus_SPI       _bus;
  lgfx::Light_PWM     _light;

public:
  LGFX() {
    {
      auto cfg = _bus.config();
      cfg.spi_host   = SPI2_HOST;
      cfg.spi_mode   = 0;
      // The RC522 shares this bus and is comfortable to ~10 MHz, but the
      // two devices are driven at different times with separate chip
      // selects, so the display can run fast.
      cfg.freq_write = 40000000;
      cfg.freq_read  = 16000000;
      cfg.spi_3wire  = false;
      cfg.use_lock   = true;            // required: two devices, one bus
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk   = PIN_SPI_SCK;
      cfg.pin_mosi   = PIN_SPI_MOSI;
      cfg.pin_miso   = PIN_SPI_MISO;
      cfg.pin_dc     = PIN_TFT_DC;
      _bus.config(cfg);
      _panel.setBus(&_bus);
    }
    {
      auto cfg = _panel.config();
      cfg.pin_cs          = PIN_TFT_CS;
      cfg.pin_rst         = PIN_TFT_RST;
      cfg.pin_busy        = -1;
      cfg.panel_width     = 320;
      cfg.panel_height    = 480;
      cfg.offset_x        = 0;
      cfg.offset_y        = 0;
      cfg.offset_rotation = 0;
      cfg.dummy_read_pixel = 8;
      cfg.dummy_read_bits  = 1;
      cfg.readable        = true;
      cfg.invert          = false;
      cfg.rgb_order       = false;
      cfg.dlen_16bit      = false;
      cfg.bus_shared      = true;       // the RC522 is on this bus too
      _panel.config(cfg);
    }
    {
      auto cfg = _light.config();
      cfg.pin_bl      = PIN_TFT_BL;
      cfg.invert      = false;
      cfg.freq        = 44100;
      cfg.pwm_channel = 7;
      _light.config(cfg);
      _panel.setLight(&_light);
    }
    setPanel(&_panel);
  }
};
