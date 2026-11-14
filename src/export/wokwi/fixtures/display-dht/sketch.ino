#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(2, DHT22);

void setup() {
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  delay(2000);
}
