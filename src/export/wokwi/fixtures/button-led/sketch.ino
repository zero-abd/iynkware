const int BUTTON = 2;
const int LED = 8;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, digitalRead(BUTTON) == LOW ? HIGH : LOW);
}
