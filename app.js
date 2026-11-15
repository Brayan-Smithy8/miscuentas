'use strict';
/* Mis Cuentas — app personal de finanzas. Todos los datos se guardan en este dispositivo (localStorage). */

const STORE_KEY = 'miscuentas.v1';
const $ = (s, el = document) => el.querySelector(s);
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmt = n => eur.format(n || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- fechas (siempre en hora local, formato YYYY-MM-DD) ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dateIn = (y, m, day) => new Date(y, m, Math.min(day, daysInMonth(y, m)));
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthLabel = key => { const [y, m] = key.split('-').map(Number); const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const shortDate = s => parseISO(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };

/* ---------- datos ---------- */
// Palabras completas (no trozos): "dia" no coincide con "MediaMarkt". Comercios de Bélgica y España.
const DEFAULT_CATS = [
  ['Nómina', 'nomina, salario, salaire, loon, wedde, salary, payroll'],
  ['Ingresos', 'transferencia recibida, bizum recibido, reembolso, devolucion, abono, remboursement, terugbetaling, refund, virement recu, overschrijving ontvangen'],
  ['Vivienda', 'alquiler, hipoteca, loyer, huur, syndic, precompte immobilier, onroerende voorheffing'],
  ['Suministros', 'engie, electrabel, luminus, totalenergies power, eneco, mega, octa+, vivaqua, swde, de watergroep, farys, proximus, telenet, orange belgium, base be, mobile vikings, scarlet, voo, iberdrola, endesa, movistar, vodafone'],
  ['Supermercado', 'delhaize, ad delhaize, proxy delhaize, shop n go, colruyt, okay colruyt, spar, aldi, lidl, carrefour, carrefour market, carrefour express, albert heijn, intermarche, cora, match, louis delhaize, bio planet, jumbo, mercadona, dia'],
  ['Transporte', 'sncb, nmbs, stib, mivb, de lijn, tec, q8, esso, lukoil, texaco, gabriels, dats 24, totalenergies, shell, bp, uber, bolt, heetch, taxi, villo, blue bike, poppy, cambio, interparking, indigo, parking, eurostar, thalys, repsol, renfe, ryanair, brussels airlines'],
  ['Restaurantes', 'restaurant, restaurante, brasserie, friterie, frituur, cafe, bar, exki, le pain quotidien, panos, quick, mcdonald, burger king, starbucks, deliveroo, takeaway, takeaway com, uber eats, glovo, just eat, pizza hut'],
  ['Ocio', 'netflix, spotify, disney, prime video, streamz, cinema, kinepolis, ugc, steam, playstation, xbox, apple com, youtube, fnac, ticketmaster'],
  ['Compras', 'amazon, bol com, zalando, coolblue, mediamarkt, vanden borre, krefel, action, hema, kruidvat, ici paris xl, ici paris, inno, zara, primark, h&m, decathlon, ikea, brico, gamma, hubo, aliexpress, shein, temu'],
  ['Salud', 'pharmacie, apotheek, farmacia, dentiste, tandarts, medecin, dokter, hopital, ziekenhuis, mutualite, mutualiteit, mutualité, cm, solidaris, partenamut, helan, basic fit, jims'],
  ['Seguros', 'assurance, verzekering, seguro, ag insurance, ethias, axa, allianz, baloise, p&v, dvv'],
  ['Efectivo', 'cajero, retirada, atm, retrait, geldopname, bancontact atm, cash'],
  ['Otros', '']
].map(([nombre, palabras]) => ({ nombre, palabras: palabras.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) }));

function emptyState() {
  return {
    version: 1,
    movimientos: [],
    pagos: [],
    tarjetas: [],
    categorias: DEFAULT_CATS,
    ajustes: { scriptUrl: '', token: '', ultimaSync: null, ultimaCopia: null, notificados: {}, gmailVistos: {} }
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const base = emptyState();
    return { ...base, ...s, ajustes: { ...base.ajustes, ...(s.ajustes || {}) } };
  } catch (e) { console.error(e); return emptyState(); }
}
let S = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('No se pudo guardar: ' + e.message); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// "AD Delhaize Ixelles*1234" → " ad delhaize ixelles 1234 " (sin acentos ni signos) para buscar palabras completas.
const normalizar = s => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&+]+/g, ' ').trim() + ' ';
function autoCategoria(texto, esIngreso) {
  const t = normalizar(texto);
  for (const c of S.categorias) {
    if (c.palabras.some(p => { const k = normalizar(p); return k.trim() && t.includes(k); })) {
      const isIncomeCat = c.nombre === 'Nómina' || c.nombre === 'Ingresos';
      if (isIncomeCat === !!esIngreso) return c.nombre;
    }
  }
  return esIngreso ? 'Ingresos' : 'Otros';
}

/* ---------- vencimientos: pagos fijos + tarjetas ---------- */
function ocurrencias(p, desde, hasta) {
  const out = [];
  if (p.frecuencia === 'unico') {
    if (p.fecha) { const d = parseISO(p.fecha); if (d >= desde && d <= hasta) out.push(d); }
    return out;
  }
  if (p.frecuencia === 'anual') {
    for (let y = desde.getFullYear(); y <= hasta.getFullYear(); y++) {
      const d = dateIn(y, (p.mes || 1) - 1, p.dia);
      if (d >= desde && d <= hasta) out.push(d);
    }
    return out;
  }
  // mensual
  let y = desde.getFullYear(), m = desde.getMonth();
  while (new Date(y, m, 1) <= hasta) {
    const d = dateIn(y, m, p.dia);
    if (d >= desde && d <= hasta) out.push(d);
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

function vencimientos(diasAdelante = 45, diasAtras = 35) {
  const hoy = today();
  const desde = new Date(hoy); desde.setDate(desde.getDate() - diasAtras);
  const hasta = new Date(hoy); hasta.setDate(hasta.getDate() + diasAdelante);
  const list = [];
  // no mostrar como "vencido" lo anterior a cuando se dio de alta el pago o la tarjeta
  const inicio = x => x.creado && parseISO(x.creado) > desde ? parseISO(x.creado) : desde;
  for (const p of S.pagos) {
    for (const d of ocurrencias(p, inicio(p), hasta)) {
      const f = iso(d);
      list.push({ tipo: 'pago', ref: p, id: p.id, nombre: p.nombre, importe: p.importe, fecha: f, avisarDias: p.avisarDias ?? 3, pagado: !!(p.pagados || {})[f], dias: daysBetween(hoy, d) });
    }
  }
  for (const t of S.tarjetas) {
    if (!t.diaPago) continue;
    for (const d of ocurrencias({ frecuencia: 'mensual', dia: t.diaPago }, inicio(t), hasta)) {
      const f = iso(d);
      let importe = t.saldo || 0;
      const ex = t.ultimoExtracto;
      if (ex && ex.fechaLimite && monthKey(parseISO(ex.fechaLimite)) === monthKey(d)) importe = ex.importe;
      list.push({ tipo: 'tarjeta', ref: t, id: t.id, nombre: 'Tarjeta ' + t.nombre, importe, fecha: f, avisarDias: t.avisarDias ?? 3, pagado: !!(t.pagados || {})[f], dias: daysBetween(hoy, d) });
    }
  }
  return list.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
const pendientes = () => vencimientos().filter(v => !v.pagado && (v.dias >= 0 || v.dias >= -31));

function estadoTag(v) {
  if (v.pagado) return '<span class="tag">Pagado</span>';
  if (v.dias < 0) return `<span class="tag due">Vencido hace ${-v.dias} d</span>`;
  if (v.dias === 0) return '<span class="tag due">Hoy</span>';
  if (v.dias <= v.avisarDias) return `<span class="tag soon">En ${v.dias} d</span>`;
  return `<span class="tag">En ${v.dias} d</span>`;
}

/* ---------- notificaciones ---------- */
async function notificar() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const hoyKey = iso(today());
  const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
  let changed = false;
  for (const v of pendientes()) {
    if (v.dias > v.avisarDias) continue;
    const key = `${v.id}|${v.fecha}|${hoyKey}`;
    if (S.ajustes.notificados[key]) continue;
    const cuando = v.dias < 0 ? `venció hace ${-v.dias} días` : v.dias === 0 ? 'vence hoy' : `vence en ${v.dias} días`;
    const body = `${fmt(v.importe)} · ${cuando} (${shortDate(v.fecha)})`;
    try {
      if (reg) await reg.showNotification(v.nombre, { body, tag: key, icon: 'icon-192.png' });
      else new Notification(v.nombre, { body, tag: key });
      S.ajustes.notificados[key] = true; changed = true;
    } catch (e) { console.warn(e); }
  }
  // limpia claves antiguas
  for (const k of Object.keys(S.ajustes.notificados)) if (!k.endsWith(hoyKey)) { delete S.ajustes.notificados[k]; changed = true; }
  if (changed) save();
}

/* ---------- calendario (.ics) ---------- */
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function icsDate(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function rruleMensual(dia) {
  return dia > 28 ? `RRULE:FREQ=MONTHLY;BYMONTHDAY=${[28, 29, 30, 31].filter(x => x <= dia).join(',')};BYSETPOS=-1` : `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dia}`;
}
function alarma(diasAntes) {
  // evento de día completo: empieza a las 00:00. Avisa a las 9:00 X días antes y a las 9:00 del mismo día.
  const a = [];
  const h = diasAntes * 24 - 9;
  if (diasAntes > 0) a.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatorio de pago', `TRIGGER:-PT${h}H`, 'END:VALARM');
  a.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Hoy toca pagar', 'TRIGGER:PT9H', 'END:VALARM');
  return a;
}
function buildICS() {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MisCuentas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mis pagos'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const hoy = today();
  const lejos = new Date(hoy); lejos.setFullYear(lejos.getFullYear() + 2);
  const add = (id, titulo, desc, d, rrule, avisar) => {
    const fin = new Date(d); fin.setDate(fin.getDate() + 1);
    L.push('BEGIN:VEVENT', `UID:${id}@miscuentas`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(d)}`, `DTEND;VALUE=DATE:${icsDate(fin)}`,
      `SUMMARY:${icsEscape(titulo)}`, `DESCRIPTION:${icsEscape(desc)}`, 'TRANSP:TRANSPARENT');
    if (rrule) L.push(rrule);
    L.push(...alarma(avisar), 'END:VEVENT');
  };
  for (const p of S.pagos) {
    const primera = ocurrencias(p, hoy, lejos)[0];
    if (!primera) continue;
    const rr = p.frecuencia === 'mensual' ? rruleMensual(p.dia) : p.frecuencia === 'anual' ? 'RRULE:FREQ=YEARLY' : null;
    add(p.id, `Pagar ${p.nombre} (${fmt(p.importe)})`, `Categoría: ${p.categoria || '-'}`, primera, rr, p.avisarDias ?? 3);
  }
  for (const t of S.tarjetas) {
    if (!t.diaPago) continue;
    const primera = ocurrencias({ frecuencia: 'mensual', dia: t.diaPago }, hoy, lejos)[0];
    add(t.id, `Pagar tarjeta ${t.nombre}`, 'Revisa el importe del extracto en Mis Cuentas', primera, rruleMensual(t.diaPago), t.avisarDias ?? 3);
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
async function compartirArchivo(texto, nombre, tipo) {
  const file = new File([texto], nombre, { type: tipo });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nombre }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function abrirEnCalendario() {
  if (!S.pagos.length && !S.tarjetas.some(t => t.diaPago)) return toast('Primero añade algún pago o tarjeta');
  location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(buildICS());
}

/* ---------- sincronización con Gmail (Apps Script) ---------- */
async function sincronizarGmail(manual = true) {
  const { scriptUrl, token } = S.ajustes;
  if (!scriptUrl || !token) { if (manual) toast('Configura el script de Gmail en Ajustes'); return; }
  const dias = S.ajustes.ultimaSync ? Math.min(90, Math.max(3, daysBetween(parseISO(S.ajustes.ultimaSync.slice(0, 10)), today()) + 3)) : 90;
  if (manual) toast('Leyendo correos…');
  try {
    const res = await fetch(scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, dias }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'respuesta no válida');
    const r = aplicarCorreos(data.items || []);
    S.ajustes.ultimaSync = new Date().toISOString();
    save(); render();
    if (manual || r.total) toast(r.total ? `Importados: ${r.ingresos} ingresos, ${r.gastos} gastos, ${r.extractos} extractos` : 'No hay correos nuevos');
  } catch (e) {
    console.error(e);
    if (manual) toast('Error al leer Gmail: ' + e.message);
  }
}
function buscarTarjeta(item) {
  const banco = (item.banco || '').toLowerCase();
  if (item.ultimos4) {
    const t = S.tarjetas.find(t => t.ultimos4 === item.ultimos4);
    if (t) return t;
  }
  return S.tarjetas.find(t => (t.banco || '').toLowerCase() === banco && (!item.ultimos4 || !t.ultimos4)) || null;
}
function aplicarCorreos(items) {
  const r = { ingresos: 0, gastos: 0, extractos: 0, total: 0 };
  const vistos = S.ajustes.gmailVistos;
  for (const it of items) {
    if (!it.id || vistos[it.id] || !(it.importe > 0)) continue;
    vistos[it.id] = it.fecha || true;
    if (it.tipo === 'extracto') {
      let t = buscarTarjeta(it);
      if (!t) {
        t = { id: uid(), nombre: `${it.banco || 'Tarjeta'}${it.ultimos4 ? ' ·' + it.ultimos4 : ''}`, banco: it.banco || '', ultimos4: it.ultimos4 || '', limite: 0, saldo: 0, diaCorte: 0, diaPago: 0, avisarDias: 3, pagados: {}, creado: it.fecha };
        S.tarjetas.push(t);
      }
      t.ultimoExtracto = { fecha: it.fecha, importe: it.importe, fechaLimite: it.fechaLimite || null };
      t.saldo = it.importe;
      if (it.fechaLimite && !t.diaPago) t.diaPago = parseISO(it.fechaLimite).getDate();
      r.extractos++;
    } else {
      const ingreso = it.tipo === 'ingreso';
      const concepto = it.concepto || (ingreso ? 'Ingreso' : 'Gasto');
      let cat = autoCategoria(concepto + ' ' + (it.texto || ''), ingreso);
      if (ingreso && /n[oó]mina|salaire|\bloon\b|salary/i.test(concepto + ' ' + (it.texto || ''))) cat = 'Nómina';
      const t = !ingreso ? buscarTarjeta(it) : null;
      S.movimientos.push({ id: uid(), fecha: it.fecha, importe: ingreso ? it.importe : -it.importe, concepto, categoria: cat, cuenta: t ? t.nombre : (it.banco || ''), origen: 'gmail', gmailId: it.id });
      if (t && it.ultimos4) t.saldo = Math.round(((t.saldo || 0) + it.importe) * 100) / 100;
      ingreso ? r.ingresos++ : r.gastos++;
    }
    r.total++;
  }
  // olvida ids de más de 120 días
  const limite = new Date(today()); limite.setDate(limite.getDate() - 120);
  for (const [k, f] of Object.entries(vistos)) if (typeof f === 'string' && parseISO(f) < limite) delete vistos[k];
  return r;
}

/* ---------- UI ---------- */
let tab = 'inicio';
let mesMov = monthKey(today());
let filtroCat = '';

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3200);
}

function resumenMes(key) {
  const movs = S.movimientos.filter(m => m.fecha.startsWith(key));
  const ingresos = movs.filter(m => m.importe > 0).reduce((a, m) => a + m.importe, 0);
  const gastos = movs.filter(m => m.importe < 0).reduce((a, m) => a - m.importe, 0);
  const porCat = {};
  for (const m of movs) if (m.importe < 0) porCat[m.categoria || 'Otros'] = (porCat[m.categoria || 'Otros'] || 0) - m.importe;
  return { ingresos, gastos, balance: ingresos - gastos, porCat, movs };
}

function barras(porCat) {
  const items = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  if (!items.length) return '<div class="empty">Aún no hay gastos este mes</div>';
  const max = items[0][1];
  const total = items.reduce((a, [, v]) => a + v, 0);
  return `<div class="bars" role="img" aria-label="Gastos por categoría">${items.map(([c, v]) =>
    `<div class="b" tabindex="0" title="${esc(c)}: ${fmt(v)} (${Math.round(v / total * 100)} % del gasto)"><span class="name">${esc(c)}</span><div class="track"><div class="fill" style="width:${Math.max(1, v / max * 100)}%"></div></div><span class="v">${fmt(v)}</span></div>`).join('')}</div>
    <details><summary>Ver como tabla</summary><table class="tbl">${items.map(([c, v]) => `<tr><td>${esc(c)}</td><td>${Math.round(v / total * 100)} %</td><td>${fmt(v)}</td></tr>`).join('')}</table></details>`;
}

function filaVenc(v, conBoton = true) {
  return `<div class="row"><div class="grow"><div class="t">${esc(v.nombre)}</div><div class="s">${shortDate(v.fecha)} · ${estadoTag(v)}</div></div>
    <div class="amt">${fmt(v.importe)}</div>
    ${conBoton && !v.pagado ? `<button class="small" data-pagar="${v.tipo}|${v.id}|${v.fecha}">Pagado</button>` : ''}</div>`;
}

function viewInicio() {
  const key = monthKey(today());
  const r = resumenMes(key);
  const pend = pendientes();
  const urgentes = pend.filter(v => v.dias <= v.avisarDias);
  const proximos = pend.filter(v => v.dias <= 30).slice(0, 8);
  const porPagarMes = pend.filter(v => v.fecha.startsWith(key)).reduce((a, v) => a + (v.importe || 0), 0);
  const deudaTarjetas = S.tarjetas.reduce((a, t) => a + (t.saldo || 0), 0);
  const nomina = S.movimientos.filter(m => m.categoria === 'Nómina' && m.importe > 0).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  const copiaVieja = S.movimientos.length > 10 && (!S.ajustes.ultimaCopia || daysBetween(parseISO(S.ajustes.ultimaCopia.slice(0, 10)), today()) > 30);
  const esIOS = /iphone|ipad/i.test(navigator.userAgent);
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `
    ${esIOS && !instalada ? `<div class="banner">Para recibir avisos, instala la app: en Safari pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.</div>` : ''}
    ${urgentes.map(v => `<div class="banner ${v.dias <= 0 ? 'danger' : ''}"><b>${esc(v.nombre)}</b> — ${fmt(v.importe)} ${v.dias < 0 ? `venció el ${shortDate(v.fecha)}` : v.dias === 0 ? 'vence hoy' : `vence el ${shortDate(v.fecha)}`}
      <div class="btns" style="margin-top:8px"><button class="small primary" data-pagar="${v.tipo}|${v.id}|${v.fecha}">Marcar pagado</button></div></div>`).join('')}
    ${copiaVieja ? `<div class="banner">Hace más de un mes que no haces copia de seguridad. <button class="small" data-go="ajustes">Hacer copia</button></div>` : ''}
    <div class="card">
      <h2>${monthLabel(key)}</h2>
      <div class="hero stat"><div class="lbl">Balance del mes</div><div class="val ${r.balance >= 0 ? 'pos' : 'neg'}">${fmt(r.balance)}</div></div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><div class="lbl">Ingresos</div><div class="val">${fmt(r.ingresos)}</div></div>
        <div class="stat"><div class="lbl">Gastos</div><div class="val">${fmt(r.gastos)}</div></div>
        <div class="stat"><div class="lbl">Por pagar</div><div class="val">${fmt(porPagarMes)}</div></div>
      </div>
      <div class="small-note" style="margin-top:8px">Te quedaría <b>${fmt(r.balance - porPagarMes)}</b> tras los pagos pendientes de este mes.${nomina ? ` Última nómina: ${fmt(nomina.importe)} el ${shortDate(nomina.fecha)}.` : ''}</div>
    </div>
    <div class="card"><h2>Próximos 30 días</h2>${proximos.length ? proximos.map(v => filaVenc(v)).join('') : '<div class="empty">Nada pendiente. Añade tus pagos fijos en la pestaña Pagos.</div>'}</div>
    <div class="card"><h2>Gastos por categoría</h2>${barras(r.porCat)}</div>
    ${S.tarjetas.length ? `<div class="card"><h2>Tarjetas · deuda total ${fmt(deudaTarjetas)}</h2>${S.tarjetas.map(t => `<div class="row"><div class="grow"><div class="t">${esc(t.nombre)}</div><div class="s">${t.diaPago ? 'Pago el día ' + t.diaPago : 'Sin día de pago'}</div></div><div class="amt">${fmt(t.saldo)}</div></div>`).join('')}</div>` : ''}
    ${S.ajustes.scriptUrl ? `<div class="btns"><button data-sync>↻ Leer correos de Gmail</button></div><div class="small-note" style="margin-top:6px">${S.ajustes.ultimaSync ? 'Última lectura: ' + new Date(S.ajustes.ultimaSync).toLocaleString('es-ES') : 'Aún no se han leído correos'}</div>` : ''}
  `;
}

function viewMovimientos() {
  const r = resumenMes(mesMov);
  let movs = r.movs.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.id > a.id ? 1 : -1));
  if (filtroCat) movs = movs.filter(m => m.categoria === filtroCat);
  const cats = [...new Set(r.movs.map(m => m.categoria))].sort();
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="monthnav"><button class="icon" data-mes="-1" aria-label="Mes anterior">‹</button><span>${monthLabel(mesMov)}</span><button class="icon" data-mes="1" aria-label="Mes siguiente">›</button></div>
        <select id="filtroCat" style="width:auto;max-width:45%"><option value="">Todas</option>${cats.map(c => `<option ${c === filtroCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><div class="lbl">Ingresos</div><div class="val">${fmt(r.ingresos)}</div></div>
        <div class="stat"><div class="lbl">Gastos</div><div class="val">${fmt(r.gastos)}</div></div>
        <div class="stat"><div class="lbl">Balance</div><div class="val ${r.balance >= 0 ? 'pos' : ''}">${fmt(r.balance)}</div></div>
      </div>
    </div>
    <div class="card">${movs.length ? movs.map(m => `<div class="row" data-editmov="${m.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(m.concepto)}</div><div class="s">${shortDate(m.fecha)} · ${esc(m.categoria)}${m.cuenta ? ' · ' + esc(m.cuenta) : ''}${m.origen === 'gmail' ? ' · ✉' : ''}</div></div><div class="amt ${m.importe > 0 ? 'pos' : ''}">${m.importe > 0 ? '+' : ''}${fmt(m.importe)}</div></div>`).join('') : '<div class="empty">No hay movimientos este mes. Pulsa + para añadir uno.</div>'}</div>`;
}

function viewPagos() {
  const ven = vencimientos(60, 35).filter(v => v.tipo === 'pago');
  const freq = p => p.frecuencia === 'mensual' ? `Cada mes, día ${p.dia}` : p.frecuencia === 'anual' ? `Cada año, ${p.dia}/${p.mes}` : `Una vez, ${p.fecha ? shortDate(p.fecha) : ''}`;
  return `
    <div class="card"><h2>Calendario</h2>
      <div class="small-note">Añade los pagos al Calendario del iPhone para que te avise aunque no abras la app. Si cambias un pago, vuelve a añadirlos.</div>
      <div class="btns" style="margin-top:10px"><button class="primary" data-ics="abrir">📅 Añadir al Calendario</button><button data-ics="compartir">Compartir .ics</button></div>
    </div>
    <div class="card"><h2>Pendientes</h2>${ven.filter(v => !v.pagado).length ? ven.filter(v => !v.pagado).map(v => filaVenc(v)).join('') : '<div class="empty">Nada pendiente</div>'}</div>
    <div class="card"><h2>Pagos fijos</h2>${S.pagos.length ? S.pagos.map(p => `<div class="row" data-editpago="${p.id}" style="cursor:pointer"><div class="grow"><div class="t">${esc(p.nombre)}</div><div class="s">${freq(p)} · aviso ${p.avisarDias} d antes</div></div><div class="amt">${fmt(p.importe)}</div></div>`).join('') : '<div class="empty">Pulsa + para añadir alquiler, recibos, suscripciones…</div>'}</div>`;
}

function viewTarjetas() {
  return S.tarjetas.length ? S.tarjetas.map(t => {
    const ex = t.ultimoExtracto;
    const uso = t.limite ? Math.min(100, (t.saldo || 0) / t.limite * 100) : null;
    return `<div class="card" data-edittarj="${t.id}" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(t.nombre)}</b><span class="tag">${esc(t.banco || '')}${t.ultimos4 ? ' ·' + esc(t.ultimos4) : ''}</span></div>
      <div class="hero stat" style="margin-top:8px"><div class="lbl">Saldo pendiente</div><div class="val">${fmt(t.saldo)}</div></div>
      ${uso !== null ? `<div class="small-note">${Math.round(uso)} % de ${fmt(t.limite)} de límite</div><div style="height:8px;background:var(--surface-2);border-radius:4px;margin-top:4px"><div style="height:8px;width:${uso}%;background:var(--bar);border-radius:4px"></div></div>` : ''}
      <div class="small-note" style="margin-top:8px">${t.diaCorte ? 'Corte el día ' + t.diaCorte + ' · ' : ''}${t.diaPago ? 'Pago el día ' + t.diaPago : 'Sin día de pago'}</div>
      ${ex ? `<div class="small-note">Último extracto (${shortDate(ex.fecha)}): <b>${fmt(ex.importe)}</b>${ex.fechaLimite ? ' · pagar antes del ' + shortDate(ex.fechaLimite) : ''}</div>` : ''}
    </div>`;
  }).join('') : '<div class="card"><div class="empty">Pulsa + para añadir una tarjeta, o lee los correos de Gmail: los extractos crean la tarjeta automáticamente.</div></div>';
}

function viewAjustes() {
  const a = S.ajustes;
  const perm = 'Notification' in window ? Notification.permission : 'no-disponible';
  return `
    <div class="card"><h2>Notificaciones</h2>
      <div class="small-note">${perm === 'granted' ? '✅ Activadas. Te avisaremos al abrir la app de lo que vence pronto.' : perm === 'denied' ? 'Bloqueadas. Actívalas en Ajustes del iPhone → Notificaciones → Mis Cuentas.' : perm === 'no-disponible' ? 'En iPhone las notificaciones solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o superior).' : 'Aún no activadas.'}</div>
      ${perm === 'default' ? '<div class="btns" style="margin-top:10px"><button class="primary" data-notif>Activar notificaciones</button></div>' : ''}
    </div>
    <div class="card"><h2>Gmail (BBVA y Revolut)</h2>
      <div class="small-note">Pega la URL y la clave que te da el script al instalarlo (mira la guía LEEME).</div>
      <label for="aUrl">URL del script</label><input id="aUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(a.scriptUrl)}" autocomplete="off">
      <label for="aTok">Clave</label><input id="aTok" type="password" value="${esc(a.token)}" autocomplete="off">
      <div class="btns" style="margin-top:10px"><button class="primary" data-saveg>Guardar</button><button data-sync>Leer correos ahora</button></div>
    </div>
    <div class="card"><h2>Categorías</h2>
      <div class="small-note">Una por línea: <i>Nombre: palabra, palabra</i>. Si el concepto contiene una palabra, se asigna esa categoría.</div>
      <textarea id="aCats">${esc(S.categorias.map(c => c.nombre + ': ' + c.palabras.join(', ')).join('\n'))}</textarea>
      <div class="btns" style="margin-top:10px"><button data-savecats>Guardar categorías</button><button data-recat>Recategorizar movimientos</button></div>
    </div>
    <div class="card"><h2>Copia de seguridad</h2>
      <div class="small-note">Tus datos solo están en este móvil. Guarda una copia en Archivos o iCloud de vez en cuando.${a.ultimaCopia ? ' Última copia: ' + new Date(a.ultimaCopia).toLocaleDateString('es-ES') + '.' : ''}</div>
      <div class="btns" style="margin-top:10px"><button class="primary" data-backup>Exportar copia</button><button data-restore>Restaurar copia</button><input type="file" id="fRestore" accept="application/json,.json" class="hidden"></div>
      <div class="btns" style="margin-top:10px"><button class="danger" data-wipe>Borrar todos los datos</button></div>
    </div>
    <div class="small-note" style="text-align:center">Mis Cuentas · ${S.movimientos.length} movimientos · ${S.pagos.length} pagos · ${S.tarjetas.length} tarjetas</div>`;
}

const VIEWS = { inicio: ['Mis Cuentas', viewInicio], movimientos: ['Movimientos', viewMovimientos], pagos: ['Pagos', viewPagos], tarjetas: ['Tarjetas', viewTarjetas], ajustes: ['Ajustes', viewAjustes] };
function render() {
  const [titulo, fn] = VIEWS[tab];
  $('#title').textContent = titulo;
  $('#view').innerHTML = fn();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').classList.toggle('hidden', !['inicio', 'movimientos', 'pagos', 'tarjetas'].includes(tab));
}

/* ---------- formularios ---------- */
const dlg = $('#dlg'), form = $('#dlgForm');
function abrirForm(html, onSave, onDelete) {
  form.innerHTML = html + `<div class="btns" style="margin-top:16px;justify-content:space-between">
    ${onDelete ? '<button type="button" class="danger" data-del>Eliminar</button>' : '<span></span>'}
    <div class="btns"><button type="button" data-cancel>Cancelar</button><button type="submit" class="primary">Guardar</button></div></div>`;
  form.onsubmit = e => { e.preventDefault(); if (onSave(new FormData(form)) !== false) { dlg.close(); save(); render(); } };
  form.querySelector('[data-cancel]').onclick = () => dlg.close();
  if (onDelete) form.querySelector('[data-del]').onclick = () => { if (confirm('¿Eliminar?')) { onDelete(); dlg.close(); save(); render(); } };
  dlg.showModal();
}
const num = v => {
  let s = String(v || '').trim().replace(/\s|€/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56 → 1234.56
  const n = parseFloat(s); return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};
const numStr = n => n ? String(n).replace('.', ',') : '';
const catOptions = sel => S.categorias.map(c => `<option ${c.nombre === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
const cuentaOptions = sel => ['', ...new Set([...S.tarjetas.map(t => t.nombre), 'BBVA', 'Revolut', 'Efectivo'])].map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${c ? esc(c) : '—'}</option>`).join('');

function formMovimiento(m) {
  const nuevo = !m;
  m = m || { fecha: iso(today()), importe: 0, concepto: '', categoria: '', cuenta: '' };
  const tipo = m.importe > 0 ? 'ingreso' : 'gasto';
  abrirForm(`<h3>${nuevo ? 'Nuevo movimiento' : 'Editar movimiento'}</h3>
    <div class="seg" style="margin-top:10px" id="segTipo"><button type="button" data-t="gasto" class="${tipo === 'gasto' ? 'on' : ''}">Gasto</button><button type="button" data-t="ingreso" class="${tipo === 'ingreso' ? 'on' : ''}">Ingreso</button></div>
    <input type="hidden" name="tipo" value="${tipo}">
    <label>Importe (€)</label><input name="importe" inputmode="decimal" required value="${numStr(Math.abs(m.importe))}" placeholder="0,00">
    <label>Concepto</label><input name="concepto" required value="${esc(m.concepto)}" placeholder="Mercadona, nómina…">
    <div class="grid2"><div><label>Fecha</label><input type="date" name="fecha" required value="${m.fecha}"></div>
    <div><label>Cuenta</label><select name="cuenta">${cuentaOptions(m.cuenta)}</select></div></div>
    <label>Categoría</label><select name="categoria"><option value="">Automática</option>${catOptions(m.categoria)}</select>`,
    fd => {
      const ingreso = fd.get('tipo') === 'ingreso';
      const imp = num(fd.get('importe')); if (!imp) { toast('Pon un importe'); return false; }
      const concepto = fd.get('concepto').trim();
      const datos = { fecha: fd.get('fecha'), importe: ingreso ? imp : -imp, concepto, cuenta: fd.get('cuenta'), categoria: fd.get('categoria') || autoCategoria(concepto, ingreso) };
      if (nuevo) S.movimientos.push({ id: uid(), origen: 'manual', ...datos }); else Object.assign(m, datos);
    },
    nuevo ? null : () => { S.movimientos = S.movimientos.filter(x => x !== m); });
  form.querySelectorAll('#segTipo button').forEach(b => b.onclick = () => {
    form.querySelectorAll('#segTipo button').forEach(x => x.classList.toggle('on', x === b));
    form.elements.tipo.value = b.dataset.t;
  });
}

function formPago(p) {
  const nuevo = !p;
  p = p || { nombre: '', importe: 0, frecuencia: 'mensual', dia: today().getDate(), mes: today().getMonth() + 1, fecha: iso(today()), avisarDias: 3, categoria: 'Vivienda', cuenta: '' };
  abrirForm(`<h3>${nuevo ? 'Nuevo pago fijo' : 'Editar pago'}</h3>
    <label>Nombre</label><input name="nombre" required value="${esc(p.nombre)}" placeholder="Alquiler, luz, Netflix…">
    <div class="grid2"><div><label>Importe (€)</label><input name="importe" inputmode="decimal" value="${numStr(p.importe)}" placeholder="0,00"></div>
    <div><label>Frecuencia</label><select name="frecuencia" id="fFreq"><option value="mensual">Mensual</option><option value="anual">Anual</option><option value="unico">Una vez</option></select></div></div>
    <div class="grid2" id="fDiaMes"><div><label>Día del mes</label><input name="dia" type="number" min="1" max="31" value="${p.dia}"></div>
    <div id="fMes"><label>Mes</label><input name="mes" type="number" min="1" max="12" value="${p.mes || 1}"></div></div>
    <div id="fFecha"><label>Fecha</label><input type="date" name="fecha" value="${p.fecha || iso(today())}"></div>
    <div class="grid2"><div><label>Avisar días antes</label><input name="avisarDias" type="number" min="0" max="30" value="${p.avisarDias}"></div>
    <div><label>Categoría</label><select name="categoria">${catOptions(p.categoria)}</select></div></div>
    <label>Se paga desde</label><select name="cuenta">${cuentaOptions(p.cuenta)}</select>`,
    fd => {
      const datos = { nombre: fd.get('nombre').trim(), importe: num(fd.get('importe')), frecuencia: fd.get('frecuencia'), dia: Math.min(31, Math.max(1, +fd.get('dia') || 1)), mes: Math.min(12, Math.max(1, +fd.get('mes') || 1)), fecha: fd.get('fecha'), avisarDias: Math.max(0, +fd.get('avisarDias') || 0), categoria: fd.get('categoria'), cuenta: fd.get('cuenta') };
      if (datos.frecuencia === 'unico') datos.dia = parseISO(datos.fecha).getDate();
      if (nuevo) S.pagos.push({ id: uid(), pagados: {}, creado: iso(today()), ...datos }); else Object.assign(p, datos);
    },
    nuevo ? null : () => { S.pagos = S.pagos.filter(x => x !== p); });
  const sel = form.elements.frecuencia; sel.value = p.frecuencia;
  const upd = () => { $('#fDiaMes', form).classList.toggle('hidden', sel.value === 'unico'); $('#fMes', form).classList.toggle('hidden', sel.value !== 'anual'); $('#fFecha', form).classList.toggle('hidden', sel.value !== 'unico'); };
  sel.onchange = upd; upd();
}

function formTarjeta(t) {
  const nuevo = !t;
  t = t || { nombre: '', banco: 'BBVA', ultimos4: '', limite: 0, saldo: 0, diaCorte: '', diaPago: '', avisarDias: 3 };
  abrirForm(`<h3>${nuevo ? 'Nueva tarjeta' : 'Editar tarjeta'}</h3>
    <label>Nombre</label><input name="nombre" required value="${esc(t.nombre)}" placeholder="Visa BBVA">
    <div class="grid2"><div><label>Banco</label><select name="banco">${['BBVA', 'Revolut', 'Otro'].map(b => `<option ${b === t.banco ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
    <div><label>Últimos 4 dígitos</label><input name="ultimos4" inputmode="numeric" maxlength="4" pattern="[0-9]{0,4}" value="${esc(t.ultimos4)}" placeholder="opcional"></div></div>
    <div class="grid2"><div><label>Saldo pendiente (€)</label><input name="saldo" inputmode="decimal" value="${numStr(t.saldo)}"></div>
    <div><label>Límite (€)</label><input name="limite" inputmode="decimal" value="${numStr(t.limite)}"></div></div>
    <div class="grid2"><div><label>Día de corte</label><input name="diaCorte" type="number" min="1" max="31" value="${t.diaCorte || ''}"></div>
    <div><label>Día de pago</label><input name="diaPago" type="number" min="1" max="31" value="${t.diaPago || ''}"></div></div>
    <label>Avisar días antes</label><input name="avisarDias" type="number" min="0" max="30" value="${t.avisarDias ?? 3}">
    <div class="small-note" style="margin-top:6px">Los últimos 4 dígitos sirven para asociar los correos a esta tarjeta.</div>`,
    fd => {
      const datos = { nombre: fd.get('nombre').trim(), banco: fd.get('banco'), ultimos4: fd.get('ultimos4').trim(), saldo: num(fd.get('saldo')), limite: num(fd.get('limite')), diaCorte: +fd.get('diaCorte') || 0, diaPago: +fd.get('diaPago') || 0, avisarDias: Math.max(0, +fd.get('avisarDias') || 0) };
      if (nuevo) S.tarjetas.push({ id: uid(), pagados: {}, creado: iso(today()), ...datos }); else Object.assign(t, datos);
    },
    nuevo ? null : () => { S.tarjetas = S.tarjetas.filter(x => x !== t); });
}

function marcarPagado(tipo, id, fecha) {
  if (tipo === 'pago') {
    const p = S.pagos.find(x => x.id === id); if (!p) return;
    p.pagados = p.pagados || {}; p.pagados[fecha] = true;
    S.movimientos.push({ id: uid(), fecha: iso(today()), importe: -(p.importe || 0), concepto: p.nombre, categoria: p.categoria || 'Otros', cuenta: p.cuenta || '', origen: 'pago' });
  } else {
    const t = S.tarjetas.find(x => x.id === id); if (!t) return;
    const v = vencimientos().find(v => v.id === id && v.fecha === fecha);
    t.pagados = t.pagados || {}; t.pagados[fecha] = true;
    t.saldo = Math.max(0, Math.round(((t.saldo || 0) - (v ? v.importe : 0)) * 100) / 100);
  }
  save(); render(); toast('Marcado como pagado');
}

/* ---------- eventos ---------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) { tab = b.dataset.tab; render(); scrollTo(0, 0); } });
$('#fab').addEventListener('click', () => { if (tab === 'pagos') formPago(); else if (tab === 'tarjetas') formTarjeta(); else formMovimiento(); });
$('#view').addEventListener('change', e => { if (e.target.id === 'filtroCat') { filtroCat = e.target.value; render(); } });
$('#view').addEventListener('click', async e => {
  const el = e.target.closest('[data-pagar],[data-mes],[data-editmov],[data-editpago],[data-edittarj],[data-ics],[data-sync],[data-notif],[data-saveg],[data-savecats],[data-recat],[data-backup],[data-restore],[data-wipe],[data-go]');
  if (!el) return;
  const d = el.dataset;
  if (d.pagar) { const [t, id, f] = d.pagar.split('|'); marcarPagado(t, id, f); }
  else if (d.mes) { mesMov = shiftMonth(mesMov, +d.mes); filtroCat = ''; render(); }
  else if (d.editmov) formMovimiento(S.movimientos.find(m => m.id === d.editmov));
  else if (d.editpago) formPago(S.pagos.find(p => p.id === d.editpago));
  else if (d.edittarj) formTarjeta(S.tarjetas.find(t => t.id === d.edittarj));
  else if (d.ics === 'abrir') abrirEnCalendario();
  else if (d.ics === 'compartir') compartirArchivo(buildICS(), 'mis-pagos.ics', 'text/calendar');
  else if ('sync' in d) sincronizarGmail(true);
  else if ('notif' in d) { const r = await Notification.requestPermission(); if (r === 'granted') { toast('Notificaciones activadas'); notificar(); } render(); }
  else if ('saveg' in d) { S.ajustes.scriptUrl = $('#aUrl').value.trim(); S.ajustes.token = $('#aTok').value.trim(); save(); toast('Guardado'); render(); }
  else if ('savecats' in d) {
    const cats = $('#aCats').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(':'); return { nombre: (i < 0 ? l : l.slice(0, i)).trim(), palabras: i < 0 ? [] : l.slice(i + 1).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) }; });
    if (!cats.some(c => c.nombre === 'Otros')) cats.push({ nombre: 'Otros', palabras: [] });
    S.categorias = cats; save(); toast('Categorías guardadas');
  }
  else if ('recat' in d) { let n = 0; for (const m of S.movimientos) { const c = autoCategoria(m.concepto, m.importe > 0); if (c !== m.categoria && !(m.categoria === 'Nómina')) { m.categoria = c; n++; } } save(); toast(`${n} movimientos recategorizados`); }
  else if ('backup' in d) { await compartirArchivo(JSON.stringify(S, null, 1), `miscuentas-${iso(today())}.json`, 'application/json'); S.ajustes.ultimaCopia = new Date().toISOString(); save(); render(); }
  else if ('restore' in d) $('#fRestore').click();
  else if ('wipe' in d) { if (confirm('¿Borrar TODOS los datos de este móvil? No se puede deshacer si no tienes copia.')) { S = emptyState(); save(); render(); } }
  else if (d.go) { tab = d.go; render(); }
});
$('#view').addEventListener('change', async e => {
  if (e.target.id !== 'fRestore' || !e.target.files[0]) return;
  try {
    const s = JSON.parse(await e.target.files[0].text());
    if (!s || !Array.isArray(s.movimientos)) throw new Error('El archivo no es una copia de Mis Cuentas');
    if (!confirm('Esto sustituye los datos actuales por los de la copia. ¿Continuar?')) return;
    const base = emptyState(); S = { ...base, ...s, ajustes: { ...base.ajustes, ...(s.ajustes || {}) } }; save(); render(); toast('Copia restaurada');
  } catch (err) { toast('No se pudo restaurar: ' + err.message); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); notificar(); autoSync(); } });

function autoSync() {
  const u = S.ajustes.ultimaSync;
  if (S.ajustes.scriptUrl && (!u || Date.now() - new Date(u).getTime() > 6 * 3600 * 1000)) sincronizarGmail(false);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(console.warn);
render();
notificar();
autoSync();
