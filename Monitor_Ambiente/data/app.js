const api = { dados: "/api/dados", historico: "/api/historico", config: "/api/config" };
const cores = { temp: "#ff780a", umid: "#5794f2", luz: "#b877d9" };
const estado = { modo: "conectando", dados: null, pontos: [], faixa: 15, sujo: false, base: Date.now() };
const sim = { ativo: false, t0: 0, limtemp: 28, limumid: 62, origem: "pot", mudou: 3550, pontos: [], ultimo: 3600 };

function el(id)
{
  return document.getElementById(id);
}

function fmt(n, d)
{
  if (n === null || n === undefined || isNaN(n))
  {
    return "--";
  }
  return Number(n).toFixed(d).replace(".", ",");
}

function horario(ms, curto)
{
  const d = new Date(ms);
  const opcoes = curto ? { hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  return d.toLocaleTimeString("pt-BR", opcoes);
}

async function buscar(url, opcoes)
{
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try
  {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal, cache: "no-store" }, opcoes));
    if (!r.ok)
    {
      throw new Error("http " + r.status);
    }
    return await r.json();
  }
  finally
  {
    clearTimeout(timer);
  }
}

function ruido(s)
{
  return Math.sin(s * 12.9898) * 0.5;
}

function leitura(s)
{
  const pico = 3 * Math.exp(-Math.pow(((s % 1200) - 800) / 40, 2));
  const temp = 25 + 3.2 * Math.sin(s / 260) + 1.1 * Math.sin(s / 37) + pico + ruido(s) * 0.4;
  const umid = 55 + 9 * Math.sin(s / 410 + 1) + 2 * Math.sin(s / 53) + ruido(s + 1) * 1.2;
  const luz = Math.max(0, Math.min(100, 55 + 35 * Math.sin(s / 600 + 2) + ruido(s + 2) * 3));
  return { temp: temp, umid: umid, luz: luz };
}

function simagora()
{
  return 3600 + (Date.now() - sim.t0) / 1000;
}

function simponto(s)
{
  const l = leitura(s);
  const al = (l.temp > sim.limtemp ? 1 : 0) + (l.umid > sim.limumid ? 2 : 0);
  return [Math.round(s), Number(l.temp.toFixed(1)), Number(l.umid.toFixed(1)), Math.round(l.luz), al];
}

function siminiciar()
{
  sim.ativo = true;
  sim.t0 = Date.now();
  sim.pontos = [];
  for (let s = 0; s <= 3600; s += 5)
  {
    sim.pontos.push(simponto(s));
  }
  sim.ultimo = 3600;
}

function simatualizar()
{
  while (sim.ultimo + 5 <= simagora())
  {
    sim.ultimo += 5;
    sim.pontos.push(simponto(sim.ultimo));
  }
  if (sim.pontos.length > 1440)
  {
    sim.pontos.splice(0, sim.pontos.length - 1440);
  }
}

function simdados()
{
  const agora = simagora();
  const l = leitura(agora);
  const al = (l.temp > sim.limtemp ? 1 : 0) + (l.umid > sim.limumid ? 2 : 0);
  return {
    agora: agora,
    temp: Number(l.temp.toFixed(1)),
    umid: Number(l.umid.toFixed(1)),
    luz: Math.round(l.luz),
    limtemp: sim.limtemp,
    limumid: sim.limumid,
    alerta: al,
    origem: sim.origem,
    mudou: sim.mudou
  };
}

function simhistorico()
{
  simatualizar();
  return { agora: simagora(), pontos: sim.pontos };
}

function simconfig(limtemp, limumid)
{
  sim.limtemp = limtemp;
  sim.limumid = limumid;
  sim.origem = "site";
  sim.mudou = simagora();
  return simdados();
}

async function obter(url, simfn)
{
  if (estado.modo === "demo")
  {
    return simfn();
  }
  try
  {
    const r = await buscar(url);
    estado.modo = "vivo";
    return r;
  }
  catch (e)
  {
    if (estado.modo === "conectando")
    {
      if (!sim.ativo)
      {
        siminiciar();
      }
      estado.modo = "demo";
      return simfn();
    }
    estado.modo = "offline";
    return null;
  }
}

function pintarmodo()
{
  const chip = el("modo");
  const textos = { conectando: "conectando", vivo: "ao vivo", demo: "modo demonstração", offline: "sem conexão" };
  chip.textContent = textos[estado.modo];
  chip.className = "chip " + estado.modo;
}

function converter(s, agora, base)
{
  return base - (agora - s) * 1000;
}

function pintardados()
{
  const d = estado.dados;
  if (!d)
  {
    return;
  }
  const alt = (d.alerta & 1) !== 0;
  const alu = (d.alerta & 2) !== 0;

  el("v-temp").textContent = fmt(d.temp, 1);
  el("v-umid").textContent = fmt(d.umid, 1);
  el("v-luz").textContent = fmt(d.luz, 0);
  el("lim-temp").textContent = "limite " + fmt(d.limtemp, 1) + " °C";
  el("lim-umid").textContent = "limite " + fmt(d.limumid, 0) + " %";

  el("p-temp").querySelector(".stat").className = "stat " + (alt ? "vermelho" : "laranja");
  el("p-umid").querySelector(".stat").className = "stat " + (alu ? "vermelho" : "azul");

  const emalerta = d.alerta !== 0;
  el("st-estado").className = "stat " + (emalerta ? "vermelho" : "verde");
  el("v-estado").textContent = emalerta ? "ALERTA" : "NORMAL";
  el("sub-estado").textContent = emalerta ? "buzzer tocando (a cada 3 s)" : "buzzer desligado";

  const partes = [];
  if (alt)
  {
    partes.push("Temperatura " + fmt(d.temp, 1) + " °C acima do limite de " + fmt(d.limtemp, 1) + " °C");
  }
  if (alu)
  {
    partes.push("Umidade " + fmt(d.umid, 1) + " % acima do limite de " + fmt(d.limumid, 0) + " %");
  }
  el("banner").classList.toggle("oculto", !emalerta);
  el("banner-texto").textContent = partes.join("  ·  ");
  document.title = (emalerta ? "⚠ ALERTA · " : "") + "Monitor de Ambiente";

  const quando = horario(converter(d.mudou, d.agora, estado.base));
  const quem = d.origem === "pot" ? "potenciômetro" : "site";
  el("origem").innerHTML = "Em vigor: <b>" + fmt(d.limtemp, 1) + " °C</b> · <b>" + fmt(d.limumid, 0) + " %</b><br>Última alteração: <b>" + quem + "</b> às " + quando;

  if (!estado.sujo)
  {
    el("in-temp").value = d.limtemp;
    el("rg-temp").value = d.limtemp;
    el("in-umid").value = d.limumid;
    el("rg-umid").value = d.limumid;
  }

  el("atualizado").textContent = horario(Date.now());
}

function filtrar()
{
  if (estado.faixa === 0)
  {
    return estado.pontos;
  }
  const corte = Date.now() - estado.faixa * 60000;
  return estado.pontos.filter((p) => p.ms >= corte);
}

function serie(lista, campo)
{
  return lista.map((p) => ({ ms: p.ms, v: p[campo] }));
}

function resumo(s)
{
  if (s.length === 0)
  {
    return null;
  }
  let min = s[0];
  let max = s[0];
  let soma = 0;
  for (const p of s)
  {
    if (p.v < min.v)
    {
      min = p;
    }
    if (p.v > max.v)
    {
      max = p;
    }
    soma += p.v;
  }
  return { min: min, max: max, media: soma / s.length };
}

function desenhar(canvas, dados, opc)
{
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0)
  {
    return;
  }
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas._args = { dados: dados, opc: opc };
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const m = { e: 44, d: 14, t: 14, b: 24 };
  const iw = w - m.e - m.d;
  const ih = h - m.t - m.b;
  const fim = Date.now();
  const ini = estado.faixa === 0 && dados.length > 0 ? dados[0].ms : fim - (estado.faixa || 15) * 60000;

  let vmin = opc.ymin;
  let vmax = opc.ymax;
  if (vmin === undefined)
  {
    let lo = opc.limite !== undefined ? opc.limite : Infinity;
    let hi = opc.limite !== undefined ? opc.limite : -Infinity;
    for (const p of dados)
    {
      lo = Math.min(lo, p.v);
      hi = Math.max(hi, p.v);
    }
    if (!isFinite(lo))
    {
      lo = 0;
      hi = 1;
    }
    const folga = (hi - lo) * 0.15 || 1;
    vmin = Math.floor(lo - folga);
    vmax = Math.ceil(hi + folga);
  }

  const x = (ms) => m.e + ((ms - ini) / (fim - ini)) * iw;
  const y = (v) => m.t + ih - ((v - vmin) / (vmax - vmin)) * ih;

  c.font = "11px Inter, Segoe UI, sans-serif";
  c.textBaseline = "middle";
  c.lineWidth = 1;

  for (let i = 0; i <= 4; i++)
  {
    const v = vmin + ((vmax - vmin) * i) / 4;
    const yy = Math.round(y(v)) + 0.5;
    c.strokeStyle = "#23272d";
    c.beginPath();
    c.moveTo(m.e, yy);
    c.lineTo(m.e + iw, yy);
    c.stroke();
    c.fillStyle = "#8e9199";
    c.textAlign = "right";
    c.fillText(fmt(v, vmax - vmin < 10 ? 1 : 0), m.e - 8, yy);
  }

  c.textBaseline = "alphabetic";
  c.textAlign = "center";
  for (let i = 0; i <= 4; i++)
  {
    const ms = ini + ((fim - ini) * i) / 4;
    const xx = x(ms);
    c.fillStyle = "#8e9199";
    c.fillText(horario(ms, estado.faixa > 15 || estado.faixa === 0), Math.min(Math.max(xx, m.e + 14), m.e + iw - 14), h - 6);
  }

  c.save();
  c.beginPath();
  c.rect(m.e, m.t, iw, ih);
  c.clip();

  if (opc.limite !== undefined && opc.limite >= vmin && opc.limite <= vmax)
  {
    const yl = y(opc.limite);
    c.fillStyle = "rgba(242, 73, 92, 0.07)";
    c.fillRect(m.e, m.t, iw, yl - m.t);
  }

  const visiveis = dados.filter((p) => p.ms >= ini);
  if (visiveis.length > 1)
  {
    const grad = c.createLinearGradient(0, m.t, 0, m.t + ih);
    grad.addColorStop(0, opc.cor + "55");
    grad.addColorStop(1, opc.cor + "05");

    let inicio = 0;
    for (let i = 1; i <= visiveis.length; i++)
    {
      const quebra = i === visiveis.length || visiveis[i].ms - visiveis[i - 1].ms > 30000;
      if (quebra)
      {
        const seg = visiveis.slice(inicio, i);
        if (seg.length > 1)
        {
          c.beginPath();
          c.moveTo(x(seg[0].ms), m.t + ih);
          for (const p of seg)
          {
            c.lineTo(x(p.ms), y(p.v));
          }
          c.lineTo(x(seg[seg.length - 1].ms), m.t + ih);
          c.closePath();
          c.fillStyle = grad;
          c.fill();

          c.beginPath();
          seg.forEach((p, k) =>
          {
            if (k === 0)
            {
              c.moveTo(x(p.ms), y(p.v));
            }
            else
            {
              c.lineTo(x(p.ms), y(p.v));
            }
          });
          c.strokeStyle = opc.cor;
          c.lineWidth = 1.6;
          c.lineJoin = "round";
          c.stroke();
        }
        inicio = i;
      }
    }
  }

  if (opc.limite !== undefined && opc.limite >= vmin && opc.limite <= vmax)
  {
    const yl = Math.round(y(opc.limite)) + 0.5;
    c.setLineDash([6, 4]);
    c.strokeStyle = "#f2495c";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(m.e, yl);
    c.lineTo(m.e + iw, yl);
    c.stroke();
    c.setLineDash([]);
  }
  c.restore();

  if (opc.limite !== undefined && opc.limite >= vmin && opc.limite <= vmax)
  {
    c.fillStyle = "#f2495c";
    c.textAlign = "right";
    c.textBaseline = "alphabetic";
    c.fillText("limite " + fmt(opc.limite, opc.casas), m.e + iw - 4, y(opc.limite) - 5);
  }

  if (visiveis.length > 0)
  {
    let pico = visiveis[0];
    for (const p of visiveis)
    {
      if (p.v > pico.v)
      {
        pico = p;
      }
    }
    const px = x(pico.ms);
    const py = y(pico.v);
    c.beginPath();
    c.arc(px, py, 3.5, 0, Math.PI * 2);
    c.fillStyle = opc.cor;
    c.fill();
    c.strokeStyle = "#14171b";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "#d8d9da";
    c.textAlign = px > m.e + iw - 40 ? "right" : "center";
    c.textBaseline = "alphabetic";
    c.fillText("pico " + fmt(pico.v, opc.casas), px, py < m.t + 14 ? py + 16 : py - 8);
  }

  const tip = canvas.parentNode.querySelector(".tip");
  if (canvas._hx !== undefined && visiveis.length > 0)
  {
    let melhor = visiveis[0];
    for (const p of visiveis)
    {
      if (Math.abs(x(p.ms) - canvas._hx) < Math.abs(x(melhor.ms) - canvas._hx))
      {
        melhor = p;
      }
    }
    const hx = x(melhor.ms);
    const hy = y(melhor.v);
    c.strokeStyle = "rgba(216, 217, 218, 0.35)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(hx, m.t);
    c.lineTo(hx, m.t + ih);
    c.stroke();
    c.beginPath();
    c.arc(hx, hy, 4.5, 0, Math.PI * 2);
    c.fillStyle = opc.cor;
    c.fill();
    c.strokeStyle = "#fff";
    c.lineWidth = 1.5;
    c.stroke();

    tip.innerHTML = "<span class='mudo'>" + horario(melhor.ms) + "</span><br><b style='color:" + opc.cor + "'>" + fmt(melhor.v, opc.casas) + " " + opc.unidade + "</b>";
    tip.classList.remove("oculto");
    const lado = hx > w / 2 ? hx - tip.offsetWidth - 12 : hx + 12;
    tip.style.left = lado + "px";
    tip.style.top = Math.max(4, hy - 20) + "px";
  }
  else
  {
    tip.classList.add("oculto");
  }
}

function spark(canvas, dados)
{
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0)
  {
    return;
  }
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (dados.length < 2)
  {
    return;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of dados)
  {
    lo = Math.min(lo, p.v);
    hi = Math.max(hi, p.v);
  }
  const faixa = hi - lo || 1;
  const ini = dados[0].ms;
  const fim = dados[dados.length - 1].ms;
  const topo = h * 0.45;
  const alt = h * 0.5;
  const x = (ms) => ((ms - ini) / (fim - ini || 1)) * w;
  const y = (v) => topo + alt - ((v - lo) / faixa) * alt;

  c.beginPath();
  c.moveTo(0, h);
  for (const p of dados)
  {
    c.lineTo(x(p.ms), y(p.v));
  }
  c.lineTo(w, h);
  c.closePath();
  c.fillStyle = "rgba(255, 255, 255, 0.22)";
  c.fill();

  c.beginPath();
  dados.forEach((p, k) =>
  {
    if (k === 0)
    {
      c.moveTo(x(p.ms), y(p.v));
    }
    else
    {
      c.lineTo(x(p.ms), y(p.v));
    }
  });
  c.strokeStyle = "rgba(255, 255, 255, 0.55)";
  c.lineWidth = 1.2;
  c.stroke();
}

function legenda(id, nome, cor, s, casas, unidade)
{
  const r = resumo(s);
  const alvo = el(id);
  if (!r)
  {
    alvo.innerHTML = "<span>Sem dados no período</span>";
    return;
  }
  alvo.innerHTML =
    "<span><i class='pt' style='background:" + cor + "'></i><b>" + nome + "</b></span>" +
    "<span>mín <b>" + fmt(r.min.v, casas) + "</b></span>" +
    "<span>média <b>" + fmt(r.media, casas) + "</b></span>" +
    "<span>máx <b>" + fmt(r.max.v, casas) + " " + unidade + "</b></span>";
}

function pintarpicos(lista)
{
  const linhas = [
    { nome: "Temperatura", campo: "temp", cor: cores.temp, casas: 1, unidade: "°C" },
    { nome: "Umidade", campo: "umid", cor: cores.umid, casas: 1, unidade: "%" },
    { nome: "Luminosidade", campo: "luz", cor: cores.luz, casas: 0, unidade: "%" }
  ];
  let html = "";
  for (const l of linhas)
  {
    const r = resumo(serie(lista, l.campo));
    if (!r)
    {
      html += "<tr><td>" + l.nome + "</td><td>--</td><td>--</td><td>--</td><td>--</td></tr>";
      continue;
    }
    html += "<tr><td class='cor' style='color:" + l.cor + "'>" + l.nome + "</td>" +
      "<td>" + fmt(r.min.v, l.casas) + " " + l.unidade + "</td>" +
      "<td>" + fmt(r.media, l.casas) + " " + l.unidade + "</td>" +
      "<td>" + fmt(r.max.v, l.casas) + " " + l.unidade + "</td>" +
      "<td>" + horario(r.max.ms) + "</td></tr>";
  }
  el("picos").innerHTML = html;
}

function pintareventos()
{
  const p = estado.pontos;
  const lista = [];
  const tipos = [
    { bit: 1, nome: "Temperatura", campo: "temp", unidade: "°C", casas: 1 },
    { bit: 2, nome: "Umidade", campo: "umid", unidade: "%", casas: 1 }
  ];
  for (let i = 1; i < p.length; i++)
  {
    if (p[i].al === p[i - 1].al)
    {
      continue;
    }
    for (const t of tipos)
    {
      const antes = (p[i - 1].al & t.bit) !== 0;
      const agora = (p[i].al & t.bit) !== 0;
      if (agora && !antes)
      {
        lista.push({ ms: p[i].ms, classe: "alerta", tag: "ALERTA", txt: t.nome + " " + fmt(p[i][t.campo], t.casas) + " " + t.unidade + " acima do limite" });
      }
      if (!agora && antes)
      {
        lista.push({ ms: p[i].ms, classe: "ok", tag: "NORMALIZADO", txt: t.nome + " " + fmt(p[i][t.campo], t.casas) + " " + t.unidade });
      }
    }
  }
  lista.reverse();
  if (lista.length === 0)
  {
    el("eventos").innerHTML = "<div class='vazio'>Nenhum alerta no histórico</div>";
    return;
  }
  let html = "";
  for (const e of lista.slice(0, 60))
  {
    html += "<div class='ev'><span class='hora'>" + horario(e.ms) + "</span><span class='tag " + e.classe + "'>" + e.tag + "</span><span>" + e.txt + "</span></div>";
  }
  el("eventos").innerHTML = html;
}

function pintargraficos()
{
  const lista = filtrar();
  const d = estado.dados;
  const st = serie(lista, "temp");
  const su = serie(lista, "umid");
  const sl = serie(lista, "luz");

  desenhar(el("g-temp"), st, { cor: cores.temp, unidade: "°C", casas: 1, limite: d ? d.limtemp : undefined });
  desenhar(el("g-umid"), su, { cor: cores.umid, unidade: "%", casas: 1, limite: d ? d.limumid : undefined });
  desenhar(el("g-luz"), sl, { cor: cores.luz, unidade: "%", casas: 0, ymin: 0, ymax: 100 });

  const recorte = (s) => s.slice(-90);
  spark(el("sp-temp"), recorte(st));
  spark(el("sp-umid"), recorte(su));
  spark(el("sp-luz"), recorte(sl));

  legenda("l-temp", "Temperatura", cores.temp, st, 1, "°C");
  legenda("l-umid", "Umidade", cores.umid, su, 1, "%");
  legenda("l-luz", "Luminosidade", cores.luz, sl, 0, "%");
  pintarpicos(lista);
  pintareventos();
}

async function ciclodados()
{
  const d = await obter(api.dados, simdados);
  if (d)
  {
    estado.base = Date.now();
    estado.dados = d;
  }
  pintarmodo();
  pintardados();
}

async function ciclohistorico()
{
  const r = await obter(api.historico, simhistorico);
  if (r)
  {
    const base = Date.now();
    estado.pontos = r.pontos.map((p) => ({ ms: converter(p[0], r.agora, base), temp: p[1], umid: p[2], luz: p[3], al: p[4] }));
  }
  pintargraficos();
}

function marcarsujo(valor)
{
  estado.sujo = valor;
  el("aplicar").disabled = !valor;
  el("restaurar").disabled = !valor;
}

function ligarcampo(rg, nb)
{
  el(rg).addEventListener("input", () =>
  {
    el(nb).value = el(rg).value;
    marcarsujo(true);
  });
  el(nb).addEventListener("input", () =>
  {
    el(rg).value = el(nb).value;
    marcarsujo(true);
  });
}

async function aplicar()
{
  const lt = Math.min(50, Math.max(0, Number(el("in-temp").value)));
  const lu = Math.min(100, Math.max(0, Number(el("in-umid").value)));
  const msg = el("msg");
  try
  {
    let d;
    if (estado.modo === "demo")
    {
      d = simconfig(lt, lu);
    }
    else
    {
      d = await buscar(api.config, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "limtemp=" + lt + "&limumid=" + lu
      });
    }
    estado.base = Date.now();
    estado.dados = d;
    marcarsujo(false);
    pintardados();
    pintargraficos();
    msg.style.color = "#73bf69";
    msg.textContent = "Limites aplicados";
  }
  catch (e)
  {
    msg.style.color = "#f2495c";
    msg.textContent = "Falha ao enviar para o ESP32";
  }
  setTimeout(() => { msg.textContent = ""; }, 3500);
}

function restaurar()
{
  marcarsujo(false);
  pintardados();
}

function ligarhover(id)
{
  const canvas = el(id);
  canvas.addEventListener("mousemove", (ev) =>
  {
    const r = canvas.getBoundingClientRect();
    canvas._hx = ev.clientX - r.left;
    if (canvas._args)
    {
      desenhar(canvas, canvas._args.dados, canvas._args.opc);
    }
  });
  canvas.addEventListener("mouseleave", () =>
  {
    canvas._hx = undefined;
    if (canvas._args)
    {
      desenhar(canvas, canvas._args.dados, canvas._args.opc);
    }
  });
}

function iniciar()
{
  ligarcampo("rg-temp", "in-temp");
  ligarcampo("rg-umid", "in-umid");
  el("aplicar").addEventListener("click", aplicar);
  el("restaurar").addEventListener("click", restaurar);
  ["g-temp", "g-umid", "g-luz"].forEach(ligarhover);

  el("faixas").addEventListener("click", (ev) =>
  {
    const b = ev.target.closest("button");
    if (!b)
    {
      return;
    }
    estado.faixa = Number(b.dataset.min);
    el("faixas").querySelectorAll("button").forEach((x) => x.classList.toggle("ativo", x === b));
    pintargraficos();
  });

  document.querySelectorAll(".secao-titulo").forEach((b) =>
  {
    b.addEventListener("click", () =>
    {
      b.parentNode.classList.toggle("fechada");
      pintargraficos();
    });
  });

  window.addEventListener("resize", pintargraficos);

  ciclodados().then(ciclohistorico).then(() =>
  {
    setInterval(ciclodados, 2000);
    setInterval(ciclohistorico, 5000);
  });
}

iniciar();
