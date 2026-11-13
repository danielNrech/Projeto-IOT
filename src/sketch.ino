#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

const int pinpottemp = 0;
const int pinpotumid = 1;
const int pinldr = 2;
const int pinbuzzer = 11;
const int pindht = 10;
const int pinsda = 6;
const int pinscl = 7;

DHT dht(pindht, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup()
{
  Serial.begin(115200);
  Wire.begin(pinsda, pinscl);
  dht.begin();
  lcd.init();
  lcd.backlight();
  pinMode(pinbuzzer, OUTPUT);
  analogReadResolution(12);
}

void loop()
{
  float temp = dht.readTemperature();
  float umid = dht.readHumidity();

  if (isnan(temp) || isnan(umid))
  {
    lcd.setCursor(0, 0);
    lcd.print("erro no DHT     ");
    noTone(pinbuzzer);
    delay(1000);
    return;
  }

  int limtemp = map(analogRead(pinpottemp), 0, 4095, 0, 50);
  int limumid = map(analogRead(pinpotumid), 0, 4095, 0, 100);
  int luz = map(analogRead(pinldr), 0, 4095, 0, 100);

  bool alerta = temp < limtemp || umid < limumid;

  if (alerta)
  {
    tone(pinbuzzer, 1000);
  }
  else
  {
    noTone(pinbuzzer);
  }

  char linha1[17];
  char linha2[17];
  snprintf(linha1, sizeof(linha1), "T%.1f U%.0f Lz%d", temp, umid, luz);
  snprintf(linha2, sizeof(linha2), "Lim%dC %d%% %s", limtemp, limumid, alerta ? "ALR" : "ok");

  lcd.setCursor(0, 0);
  lcd.print(linha1);
  lcd.print("                ");
  lcd.setCursor(0, 1);
  lcd.print(linha2);
  lcd.print("                ");

  Serial.printf("temp=%.1f umid=%.0f luz=%d limtemp=%d limumid=%d alerta=%d\n", temp, umid, luz, limtemp, limumid, alerta);

  delay(500);
}
