#include <Servo.h>

Servo arm;

void setup() {
  arm.attach(9);
}

void loop() {
  int knob = analogRead(A0);
  arm.write(map(knob, 0, 1023, 0, 180));
  delay(15);
}
