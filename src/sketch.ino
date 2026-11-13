#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

#define tipodht DHT22

const char* redenome = "Wokwi-GUEST";
const char* redesenha = "";
const char* apnome = "Monitor-Ambiente";
const char* apsenha = "12345678";

const int pinpottemp = 0;
const int pinpotumid = 1;
const int pinldr = 2;
const int pinbuzzer = 11;
const int pindht = 10;
const int pinsda = 6;
const int pinscl = 7;

const int tamanhohist = 720;
const unsigned long intervalopot = 100;
const unsigned long intervalosensor = 2000;
const unsigned long intervalolcd = 500;
const unsigned long intervalohist = 5000;
const unsigned long intervalobuzzer = 3000;
const unsigned long duracaobeep = 400;

struct ponto
{
  uint32_t t;
  int16_t temp;
  int16_t umid;
  uint8_t luz;
  uint8_t al;
};

ponto historico[tamanhohist];
int histini = 0;
int histqtd = 0;

float temp = 0;
float umid = 0;
int luz = 0;
float limtemp = 30;
float limumid = 70;
float refpottemp = 0;
float refpotumid = 0;
const char* origem = "pot";
uint32_t mudou = 0;
int alerta = 0;
bool sensorok = false;
bool beepligado = false;
String ip = "";

unsigned long ultimopot = 0;
unsigned long ultimosensor = 0;
unsigned long ultimolcd = 0;
unsigned long ultimohist = 0;
unsigned long ultimobeep = 0;

DHT dht(pindht, tipodht);
LiquidCrystal_I2C lcd(0x27, 16, 2);
WebServer server(80);

uint32_t segundos()
{
  return millis() / 1000;
}

float arredondar(float valor, float passo)
{
  return round(valor / passo) * passo;
}

float lerpot(int pino, float maximo)
{
  long soma = 0;
  for (int i = 0; i < 8; i++)
  {
    soma += analogRead(pino);
  }
  return (soma / 8.0) * maximo / 4095.0;
}

void lerpots()
{
  float pt = arredondar(lerpot(pinpottemp, 50), 0.5);
  float pu = arredondar(lerpot(pinpotumid, 100), 1);

  if (fabs(pt - refpottemp) >= 1.0)
  {
    refpottemp = pt;
    limtemp = pt;
    origem = "pot";
    mudou = segundos();
  }

  if (fabs(pu - refpotumid) >= 2.0)
  {
    refpotumid = pu;
    limumid = pu;
    origem = "pot";
    mudou = segundos();
  }
}

void lersensores()
{
  float t = dht.readTemperature();
  float u = dht.readHumidity();
  luz = map(analogRead(pinldr), 0, 4095, 0, 100);

  if (isnan(t) || isnan(u))
  {
    sensorok = false;
    return;
  }

  sensorok = true;
  temp = t;
  umid = u;
}

void avaliar()
{
  alerta = 0;
  if (sensorok && temp > limtemp)
  {
    alerta |= 1;
  }
  if (sensorok && umid > limumid)
  {
    alerta |= 2;
  }
}

void atualizarbuzzer()
{
  unsigned long agora = millis();

  if (alerta == 0)
  {
    noTone(pinbuzzer);
    beepligado = false;
    ultimobeep = agora - intervalobuzzer;
    return;
  }

  if (!beepligado && agora - ultimobeep >= intervalobuzzer)
  {
    tone(pinbuzzer, 1000);
    beepligado = true;
    ultimobeep = agora;
  }

  if (beepligado && agora - ultimobeep >= duracaobeep)
  {
    noTone(pinbuzzer);
    beepligado = false;
  }
}

void guardar()
{
  int pos = (histini + histqtd) % tamanhohist;

  if (histqtd < tamanhohist)
  {
    histqtd++;
  }
  else
  {
    histini = (histini + 1) % tamanhohist;
  }

  historico[pos].t = segundos();
  historico[pos].temp = (int16_t)round(temp * 10);
  historico[pos].umid = (int16_t)round(umid * 10);
  historico[pos].luz = (uint8_t)luz;
  historico[pos].al = (uint8_t)alerta;
}

void escrevelinha(int linha, const char* texto)
{
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", texto);
  lcd.setCursor(0, linha);
  lcd.print(buf);
}

void atualizarlcd()
{
  char l1[24];
  char l2[24];

  if (!sensorok)
  {
    snprintf(l1, sizeof(l1), "erro no DHT");
    snprintf(l2, sizeof(l2), "verifique fios");
  }
  else
  {
    snprintf(l1, sizeof(l1), "T%.1f U%.0f Lz%d", temp, umid, luz);
    snprintf(l2, sizeof(l2), "L%.0fC %.0f%% %s", limtemp, limumid, alerta ? "ALERTA" : "ok");
  }

  escrevelinha(0, l1);
  escrevelinha(1, l2);
}

String tipoarquivo(const String& caminho)
{
  if (caminho.endsWith(".html"))
  {
    return "text/html";
  }
  if (caminho.endsWith(".css"))
  {
    return "text/css";
  }
  if (caminho.endsWith(".js"))
  {
    return "application/javascript";
  }
  if (caminho.endsWith(".json"))
  {
    return "application/json";
  }
  if (caminho.endsWith(".svg"))
  {
    return "image/svg+xml";
  }
  if (caminho.endsWith(".png"))
  {
    return "image/png";
  }
  if (caminho.endsWith(".ico"))
  {
    return "image/x-icon";
  }
  return "text/plain";
}

void enviararquivo(String caminho)
{
  if (caminho.endsWith("/"))
  {
    caminho += "index.html";
  }

  if (!LittleFS.exists(caminho))
  {
    server.send(404, "text/plain", "arquivo nao encontrado");
    return;
  }

  File arquivo = LittleFS.open(caminho, "r");
  server.streamFile(arquivo, tipoarquivo(caminho));
  arquivo.close();
}

void paginainicial()
{
  enviararquivo("/");
}

void naoencontrado()
{
  enviararquivo(server.uri());
}

void enviardados()
{
  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"agora\":%lu,\"temp\":%.1f,\"umid\":%.1f,\"luz\":%d,\"limtemp\":%.1f,\"limumid\":%.0f,\"alerta\":%d,\"origem\":\"%s\",\"mudou\":%lu}",
    (unsigned long)segundos(), temp, umid, luz, limtemp, limumid, alerta, origem, (unsigned long)mudou);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", buf);
}

void enviarhistorico()
{
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", "");

  char buf[512];
  int n = snprintf(buf, sizeof(buf), "{\"agora\":%lu,\"pontos\":[", (unsigned long)segundos());

  for (int i = 0; i < histqtd; i++)
  {
    ponto& p = historico[(histini + i) % tamanhohist];
    n += snprintf(buf + n, sizeof(buf) - n, "%s[%lu,%.1f,%.1f,%u,%u]", i ? "," : "", (unsigned long)p.t, p.temp / 10.0, p.umid / 10.0, p.luz, p.al);
    if (n > (int)sizeof(buf) - 64)
    {
      server.sendContent(buf, n);
      n = 0;
    }
  }

  n += snprintf(buf + n, sizeof(buf) - n, "]}");
  server.sendContent(buf, n);
  server.sendContent("");
}

void receberconfig()
{
  if (server.hasArg("limtemp"))
  {
    limtemp = constrain(server.arg("limtemp").toFloat(), 0.0, 50.0);
  }
  if (server.hasArg("limumid"))
  {
    limumid = constrain(server.arg("limumid").toFloat(), 0.0, 100.0);
  }

  origem = "site";
  mudou = segundos();
  avaliar();
  atualizarlcd();
  enviardados();
}

void conectar()
{
  WiFi.mode(WIFI_STA);
  WiFi.begin(redenome, redesenha);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 10000)
  {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    ip = WiFi.localIP().toString();
    return;
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apnome, apsenha);
  ip = WiFi.softAPIP().toString();
}

void setup()
{
  Serial.begin(115200);
  Wire.begin(pinsda, pinscl);
  lcd.init();
  lcd.backlight();
  pinMode(pinbuzzer, OUTPUT);
  analogReadResolution(12);
  dht.begin();

  escrevelinha(0, "Monitor Ambiente");
  escrevelinha(1, "conectando...");

  LittleFS.begin(true);
  conectar();

  server.on("/", HTTP_GET, paginainicial);
  server.on("/api/dados", HTTP_GET, enviardados);
  server.on("/api/historico", HTTP_GET, enviarhistorico);
  server.on("/api/config", HTTP_POST, receberconfig);
  server.onNotFound(naoencontrado);
  server.begin();
  MDNS.begin("monitor");

  char textoip[24];
  snprintf(textoip, sizeof(textoip), "%s", ip.c_str());
  escrevelinha(1, textoip);
  Serial.printf("pagina em http://%s (ou http://monitor.local)\n", ip.c_str());
  delay(3000);

  refpottemp = arredondar(lerpot(pinpottemp, 50), 0.5);
  refpotumid = arredondar(lerpot(pinpotumid, 100), 1);
  limtemp = refpottemp;
  limumid = refpotumid;
  mudou = segundos();

  lersensores();
  avaliar();
  atualizarlcd();
}

void loop()
{
  server.handleClient();
  unsigned long agora = millis();

  if (agora - ultimopot >= intervalopot)
  {
    ultimopot = agora;
    lerpots();
    avaliar();
  }

  if (agora - ultimosensor >= intervalosensor)
  {
    ultimosensor = agora;
    lersensores();
    avaliar();
    Serial.printf("temp=%.1f umid=%.0f luz=%d limtemp=%.1f limumid=%.0f alerta=%d origem=%s\n", temp, umid, luz, limtemp, limumid, alerta, origem);
  }

  if (agora - ultimolcd >= intervalolcd)
  {
    ultimolcd = agora;
    atualizarlcd();
  }

  if (agora - ultimohist >= intervalohist)
  {
    ultimohist = agora;
    if (sensorok)
    {
      guardar();
    }
  }

  atualizarbuzzer();
}
