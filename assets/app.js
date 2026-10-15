const characterVoices = {
  cbt: ["igiari", "objection", "yiyi", "fandui", "matta", "kurae", "dengdeng", "kanzhege", "kanzhao", "holdit", "takethat"],
  yuj: ["igiari", "objection", "yiyi", "fandui", "matta", "kurae", "holdit", "takethat"],
  qian: ["igiari", "objection", "yiyi", "matta", "kurae", "holdit", "takethat"],
  wang: ["igiari", "objection", "fandui", "matta", "kurae", "dengdeng", "kanzhege", "holdit", "takethat"],
  xin: ["igiari", "objection", "fandui", "matta", "kurae", "dengdeng", "kanzhege", "holdit", "takethat"],
  dhurke: ["igiari", "objection", "fandui"], ming: ["igiari", "objection", "yiyi"], hao: ["igiari", "objection", "yiyi"],
  godo: ["igiari", "objection", "yiyi"], xiang: ["igiari", "objection", "fandui"], yanei: ["igiari", "objection", "yiyi", "fandui"],
  xun: ["igiari", "damarinaa", "objection", "silence", "fandui", "bizui"],
  nayuta: ["igiari", "satora-ja", "objection", "satorha", "fandui", "satora-cn"],
  garan: ["igiari", "hirehuse", "objection", "insolence", "fandui", "guixia"],
};
const characters = [
  ["cbt", "成步堂龙一", "ATTORNEY"], ["qian", "绫里千寻", "ATTORNEY"], ["wang", "王泥喜法介", "ATTORNEY"],
  ["xin", "希月心音", "ATTORNEY"], ["dhurke", "杜鲁克·史布国三", "ATTORNEY"], ["yuj", "御剑怜侍", "PROSECUTOR"],
  ["hao", "狩魔豪", "PROSECUTOR"], ["ming", "狩魔冥", "PROSECUTOR"], ["godo", "戈多（神乃木）", "PROSECUTOR"],
  ["yanei", "亚内", "PROSECUTOR"], ["xiang", "牙琉响也", "PROSECUTOR"], ["xun", "夕神迅", "PROSECUTOR"],
  ["nayuta", "那由他", "PROSECUTOR"], ["garan", "伽蓝·希格塔尔·苍苑", "PROSECUTOR"],
];
const voices = {
  igiari: ["異議あり!", "JAPANESE"], objection: ["Objection!", "ENGLISH"], yiyi: ["异议!", "中文"], fandui: ["反对!", "中文"],
  matta: ["待った!", "JAPANESE"], kurae: ["くらえ!", "JAPANESE"], dengdeng: ["等等!", "中文"], kanzhege: ["看这个!", "中文"],
  kanzhao: ["看招!", "中文"], holdit: ["Hold It!", "ENGLISH"], takethat: ["Take that!", "ENGLISH"], damarinaa: ["黙りなァ!", "JAPANESE"],
  silence: ["Silence!", "ENGLISH"], bizui: ["闭嘴!", "中文"], "satora-ja": ["サトラ!", "JAPANESE"], satorha: ["Satorha!", "ENGLISH"],
  "satora-cn": ["沙特拉!", "中文"], hirehuse: ["ひれ伏せ!", "JAPANESE"], insolence: ["Such Insolence!", "ENGLISH"], guixia: ["还不跪下!", "中文"],
};
const storageKey = "portable-objection-vibe-settings";
const defaults = { character: "cbt", voice: "igiari", threshold: 5, autoMusic: false, mouseMode: false };
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; } catch { /* Ignore malformed local settings. */ }
let peak = 0;
let busy = false;
let sensorActive = false;
let mouseMode = settings.mouseMode;
let lastMouseTrigger = 0;
const $ = (id) => document.getElementById(id);
const els = {
  character: $("character"), voice: $("voice"), threshold: $("threshold"), thresholdValue: $("threshold-value"),
  characterName: $("selected-character"), voiceName: $("selected-voice"), phraseArt: $("phrase-art"), stage: $("stage-frame"),
  trigger: $("trigger"), sensorToggle: $("sensor-toggle"), sensorLabel: $("sensor-label"), motion: $("motion-values"),
  motionPeak: $("motion-peak"), audio: $("voice-audio"), audioStatus: $("audio-status"), autoMusic: $("auto-music"),
  mouseMode: $("mouse-mode"), resetPeak: $("reset-peak"), hideUi: $("hide-ui"), clearCache: $("clear-cache"),
};

function saveSettings() {
  settings.character = els.character.value;
  settings.voice = els.voice.value;
  settings.threshold = Number(els.threshold.value);
  settings.autoMusic = els.autoMusic.checked;
  settings.mouseMode = els.mouseMode.checked;
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* The app remains usable without storage. */ }
}
function fillCharacters() {
  for (const [id, name, group] of characters) {
    let optgroup = els.character.querySelector(`optgroup[label="${group}"]`);
    if (!optgroup) { optgroup = document.createElement("optgroup"); optgroup.label = group; els.character.append(optgroup); }
    const option = document.createElement("option"); option.value = id; option.textContent = name; optgroup.append(option);
  }
  els.character.value = characterVoices[settings.character] ? settings.character : defaults.character;
}
function updateVoices(persist = true) {
  const allowed = characterVoices[els.character.value] || characterVoices.cbt;
  els.voice.replaceChildren();
  for (const id of allowed) {
    const [label, language] = voices[id] || [id, "VOICE"];
    const option = document.createElement("option"); option.value = id; option.textContent = `${label}   ·   ${language}`; els.voice.append(option);
  }
  els.voice.value = allowed.includes(settings.voice) ? settings.voice : allowed[0];
  updateSelection(persist);
}
function updateSelection(persist = true) {
  const character = characters.find(([id]) => id === els.character.value);
  const voice = voices[els.voice.value] || [els.voice.value, ""];
  els.characterName.textContent = character?.[1] || "角色";
  els.voiceName.textContent = voice[0];
  els.phraseArt.src = `./assets/img/${els.voice.value}.png`;
  els.phraseArt.alt = voice[0];
  if (persist) saveSettings();
}
function cacheKey() { return `portable-objection-vibe-audio:${els.character.value}:${els.voice.value}`; }
function blobAsDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
async function playVoice() {
  const src = `./assets/sound/${els.character.value}/${els.voice.value}.mp3`;
  const cached = localStorage.getItem(cacheKey());
  if (cached) { els.audio.src = cached; els.audioStatus.textContent = "语音来自本地缓存"; }
  else {
    try {
      els.audioStatus.textContent = "正在载入语音…";
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dataUrl = await blobAsDataUrl(await response.blob());
      try { localStorage.setItem(cacheKey(), dataUrl); } catch { /* Playback still works when storage is full. */ }
      els.audio.src = dataUrl;
      els.audioStatus.textContent = "语音已缓存到此浏览器";
    } catch {
      els.audio.src = src;
      els.audioStatus.textContent = "直接播放本地语音";
    }
  }
  try { await els.audio.play(); }
  catch { els.audioStatus.textContent = "浏览器未允许播放，请再点一次"; }
}
function triggerObjection() {
  if (busy) return;
  busy = true;
  els.stage.classList.remove("is-live");
  void els.stage.offsetWidth;
  els.stage.classList.add("is-live");
  window.setTimeout(() => { els.stage.classList.remove("is-live"); busy = false; }, 850);
  if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) navigator.vibrate?.(180);
  void playVoice();
  if (els.autoMusic.checked) window.setTimeout(() => document.querySelector(".aplayer-play")?.click(), 350);
}
function updateMotion(event) {
  const a = event.acceleration || event.accelerationIncludingGravity;
  if (!a) return;
  const x = Number(a.x) || 0, y = Number(a.y) || 0, z = Number(a.z) || 0;
  const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  peak = Math.max(peak, max);
  els.motion.textContent = `X  ${x.toFixed(2)}   Y  ${y.toFixed(2)}   Z  ${z.toFixed(2)}`;
  els.motionPeak.textContent = peak.toFixed(2);
  if (max >= Number(els.threshold.value)) triggerObjection();
}
async function enableMotion() {
  if (sensorActive) { window.removeEventListener("devicemotion", updateMotion); sensorActive = false; setSensorUi(false); return; }
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== "granted") throw new Error("Motion permission was not granted");
    }
    if (!("DeviceMotionEvent" in window)) throw new Error("This browser does not expose motion data");
    window.addEventListener("devicemotion", updateMotion);
    sensorActive = true;
    setSensorUi(true);
  } catch (error) {
    els.audioStatus.textContent = error.message || "无法启用动作传感器";
  }
}
function setSensorUi(active) {
  els.sensorLabel.textContent = active ? "MOTION ARMED" : "MOTION STANDBY";
  document.querySelector(".live-dot")?.classList.toggle("on", active);
  els.sensorToggle.querySelector("b").textContent = active ? "停止动作触发" : "启用动作触发";
  els.sensorToggle.querySelector("small").textContent = active ? "MOTION ACTIVE" : "ENABLE MOTION";
}
function toggleMouseMode(active) {
  mouseMode = active;
  els.mouseMode.checked = active;
  saveSettings();
  els.audioStatus.textContent = active ? "桌面鼠标动作已启用" : "桌面鼠标动作已关闭";
}
function clearAudioCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith("portable-objection-vibe-audio:")) localStorage.removeItem(key);
  }
  els.audioStatus.textContent = "语音缓存已清除";
}
function toggleHiddenUi() {
  document.body.classList.toggle("controls-hidden");
  sessionStorage.setItem("portable-objection-ui-hidden", document.body.classList.contains("controls-hidden") ? "1" : "0");
}

fillCharacters();
updateVoices(false);
els.threshold.value = Math.max(0.2, Math.min(30, Number(settings.threshold) || defaults.threshold));
els.thresholdValue.value = Number(els.threshold.value).toFixed(1);
els.threshold.style.setProperty("--fill", `${(Number(els.threshold.value) / 30) * 100}%`);
els.autoMusic.checked = Boolean(settings.autoMusic);
els.mouseMode.checked = Boolean(settings.mouseMode);
document.body.classList.toggle("controls-hidden", sessionStorage.getItem("portable-objection-ui-hidden") === "1");

els.character.addEventListener("change", () => { settings.voice = els.voice.value; updateVoices(); });
els.voice.addEventListener("change", updateSelection);
els.threshold.addEventListener("input", () => {
  els.thresholdValue.value = Number(els.threshold.value).toFixed(1);
  els.threshold.style.setProperty("--fill", `${(Number(els.threshold.value) / 30) * 100}%`);
  saveSettings();
});
els.trigger.addEventListener("click", triggerObjection);
els.sensorToggle.addEventListener("click", enableMotion);
els.resetPeak.addEventListener("click", () => { peak = 0; els.motionPeak.textContent = "0.00"; });
els.autoMusic.addEventListener("change", saveSettings);
els.mouseMode.addEventListener("change", () => toggleMouseMode(els.mouseMode.checked));
els.hideUi.addEventListener("click", toggleHiddenUi);
els.stage.addEventListener("dblclick", toggleHiddenUi);
els.clearCache.addEventListener("click", () => { clearAudioCache(); });
document.body.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); toggleMouseMode(!mouseMode); }
});
document.body.addEventListener("mousemove", () => {
  if (mouseMode && Date.now() - lastMouseTrigger > 1800) { lastMouseTrigger = Date.now(); triggerObjection(); }
});
