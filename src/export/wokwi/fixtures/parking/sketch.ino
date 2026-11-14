const int TRIG = 9;
const int ECHO = 10;
const int BUZZER = 8;

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH);
  int cm = us / 58;
  if (cm < 30) tone(BUZZER, 2000, 50);
  delay(100);
}
