(() => {
  'use strict';
  const { characterVoices, characters, voices, portraits = {} } = window.ObjectionCatalog;
  const mediaRoot = new URL('../', document.currentScript.src || location.href);
  const $ = id => document.getElementById(id);
  const storageKey = 'portable-objection-vibe-settings';
  const cachePrefix = 'portable-objection-vibe-audio:';
  const mobile = () => matchMedia('(max-width:740px)').matches;
  const defaults = { character: 'cbt', voice: 'igiari', threshold: 5, haptic: true, mouseMode: false, autoMusic: false, musicLoop: true, musicVolume: 0.7 };
  function readSettings() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; }
    catch { return { ...defaults }; }
  }
  const settings = readSettings();
  let character = Object.hasOwn(characterVoices, settings.character) ? settings.character : defaults.character;
  let voice = characterVoices[character].includes(settings.voice) ? settings.voice : characterVoices[character][0];
  const locale = l => l === 'JAPANESE' ? '日语' : l === 'ENGLISH' ? '英语' : '中文';
  let language = ['全部', '日语', '英语', '中文'].includes(settings.language) ? settings.language : mobile() ? locale(voices[voice][1]) : '全部';
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  let threshold = clamp(settings.threshold, 0.2, 80, 5);
  let armed = false, peak = 0, lastTrigger = 0, mouse = Boolean(settings.mouseMode), burstTimer, previousFocus, gravity;
  let queue = [], track = 0, objectUrl = '', playbackId = 0, cacheEpoch = 0, motionPending = false;
  const records = new Set();
  const cacheRequests = new Map();
  const voiceAudio = $('voice-audio'), musicAudio = $('music-audio');
  const characterInfo = () => characters.find(c => c[0] === character);
  const say = text => { $('status').textContent = text; };
  const asset = file => window.ObjectionAssets?.[file] || new URL(file, mediaRoot).href;
  const portraitCache = new Map(), warmedPortraitProfiles = new Set();
  let portraitSource = '', portraitRequest = 0, portraitLoading = false, avatarWarmup, avatarsRunning = false;
  const portraitProfile = () => mobile() && !document.body.classList.contains('focus-mode') ? 'mobile' : 'src';
  const portraitUrl = (id, profile = portraitProfile()) => {
    const portrait = portraits[id];
    return portrait ? asset(portrait[profile] || portrait.src) : '';
  };
  function avatarMarkup(id, name) {
    const portrait = portraits[id];
    return `<span class="avatar-letter">${name.slice(0, 1)}</span>${portrait?.preview ? `<img src="${portrait.preview}" alt="" decoding="async">` : ''}${portrait ? `<img data-avatar-src="${asset(portrait.thumbnail)}" alt="" hidden decoding="async" fetchpriority="low">` : ''}`;
  }
  function showPortrait(preview = false) {
    $('portrait').hidden = false;
    $('portrait').classList.toggle('portrait-preview', preview);
    $('placeholder').hidden = true;
    $('court').setAttribute('aria-busy', String(preview));
  }
  function hidePortrait() {
    $('portrait').hidden = true;
    $('placeholder').hidden = false;
    $('court').setAttribute('aria-busy', 'false');
  }
  function loadPortrait(source, priority = 'high') {
    const cached = portraitCache.get(source);
    if (cached) {
      if (priority === 'high') cached.image.fetchPriority = 'high';
      return cached.promise;
    }
    const image = new Image();
    image.decoding = 'async'; image.fetchPriority = priority;
    const entry = { image, ready: false };
    entry.promise = new Promise((resolve, reject) => {
      image.onload = async () => {
        try { await image.decode?.(); entry.ready = true; resolve(image); }
        catch (error) { portraitCache.delete(source); reject(error); }
      };
      image.onerror = () => { portraitCache.delete(source); reject(Error('Portrait unavailable')); };
      image.src = source;
    });
    portraitCache.set(source, entry);
    return entry.promise;
  }
  function visibleAvatarImages() {
    const dialogOpen = !$('character-dialog').hidden;
    return [...document.querySelectorAll('[data-avatar-src]')].filter(image => {
      const parent = image.closest('.avatar'), rect = parent.getBoundingClientRect();
      return Boolean(image.closest('#character-dialog')) === dialogOpen && parent.offsetParent !== null && rect.bottom > 0 && rect.top < innerHeight;
    });
  }
  function warmAvatars() {
    clearTimeout(avatarWarmup);
    if (avatarsRunning || document.hidden) return;
    avatarWarmup = setTimeout(async () => {
      if (portraitLoading) { warmAvatars(); return; }
      avatarsRunning = true;
      const images = visibleAvatarImages();
      for (const image of images) {
        if (portraitLoading || document.hidden) break;
        if (!image.isConnected) continue;
        const source = image.dataset.avatarSrc;
        try {
          await loadPortrait(source, 'low');
          if (image.isConnected) { image.src = source; image.hidden = false; delete image.dataset.avatarSrc; }
        } catch { image.remove(); /* Embedded preview and the surname remain available. */ }
      }
      avatarsRunning = false;
      if (visibleAvatarImages().length) warmAvatars();
    }, 450);
  }
  function warmPortraits() {
    const connection = navigator.connection;
    const profile = portraitProfile();
    if (window.ObjectionAssets || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '') || document.hidden || warmedPortraitProfiles.has(profile)) return;
    warmedPortraitProfiles.add(profile);
    const run = async () => {
      const ids = [...new Set([character, 'cbt', 'yuj', 'wang', ...characters.map(c => c[0])])];
      for (const id of ids) {
        if (document.hidden || navigator.connection?.saveData || profile !== portraitProfile()) { warmedPortraitProfiles.delete(profile); return; }
        // Keep one background request at a time; foreground selection gets priority.
        while (portraitLoading && !document.hidden) await new Promise(resolve => setTimeout(resolve, 150));
        if (document.hidden) { warmedPortraitProfiles.delete(profile); return; }
        const source = portraitUrl(id, profile);
        if (source && !portraitCache.has(source)) await loadPortrait(source, 'low').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    };
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(() => void run(), { timeout: 2000 });
      else void run();
    }, 1200);
  }
  function renderPortrait(name) {
    const portrait = portraits[character];
    const image = $('portrait');
    image.alt = `${name} · 法庭风格角色立绘`;
    const source = portraitUrl(character);
    if (source === portraitSource) return;
    portraitSource = source;
    const request = ++portraitRequest;
    portraitLoading = Boolean(source);
    if (!source) { image.removeAttribute('src'); hidePortrait(); return; }
    if (portraitCache.get(source)?.ready) {
      image.src = source; portraitLoading = false; showPortrait(); warmAvatars(); warmPortraits(); return;
    }
    if (portrait.preview) { image.src = portrait.preview; showPortrait(true); }
    else { image.removeAttribute('src'); hidePortrait(); $('court').setAttribute('aria-busy', 'true'); }
    void loadPortrait(source).then(() => {
      if (request !== portraitRequest) return;
      image.src = source; portraitLoading = false; showPortrait(); warmAvatars(); warmPortraits();
    }).catch(() => {
      if (request !== portraitRequest) return;
      portraitLoading = false; portraitSource = '';
      $('court').setAttribute('aria-busy', 'false');
      if (!portrait.preview) hidePortrait();
    });
  }

  function saveSettings() {
    const value = { character, voice, language, threshold, haptic: $('haptic').checked, mouseMode: mouse, autoMusic: $('auto-music').checked, musicLoop: $('music-loop').checked, musicVolume: Number($('music-volume').value) };
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Playback also works without local storage. */ }
  }

  function renderSelection() {
    const allowed = characterVoices[character];
    if (!allowed.includes(voice)) voice = allowed[0];
    const [, name, role] = characterInfo();
    const roleLabel = role === 'ATTORNEY' ? '律师' : '检察官';
    $('current-name').textContent = name;
    $('current-description').textContent = `${roleLabel} · ${allowed.length} 段语音 · 点击查看全部 14 位`;
    $('current-avatar').innerHTML = avatarMarkup(character, name);
    $('speaker').textContent = name;
    $('dialogue-line').textContent = voices[voice][0];
    $('dialogue-meta').textContent = `${roleLabel} / ${locale(voices[voice][1])} / ${allowed.length} 段可选语音`;
    $('dock-character').textContent = name;
    $('dock-voice').textContent = voices[voice][0] + ' · ' + locale(voices[voice][1]);
    $('role-tag').textContent = role === 'ATTORNEY' ? 'DEFENSE / 辩护方' : 'PROSECUTION / 检察方';
    $('placeholder-name').textContent = name;
    $('monogram').textContent = name.slice(0, 1);
    renderPortrait(name);
    $('voice-count').textContent = `${allowed.length} 段语音`;
    $('quick').innerHTML = ['cbt', 'yuj', 'wang'].map(id => `<button class="${id === character ? 'active' : ''}" data-person="${id}" aria-pressed="${id === character}">${characters.find(c => c[0] === id)[1]}</button>`).join('') + '<button id="all-characters">全部 14 位 ›</button>';
    $('quick').querySelectorAll('[data-person]').forEach(button => button.onclick = () => chooseCharacter(button.dataset.person));
    $('all-characters').onclick = openDialog;
    renderVoices();
    warmAvatars();
  }

  function renderVoices() {
    const allowed = characterVoices[character];
    if (language !== '全部' && !allowed.some(id => locale(voices[id][1]) === language)) language = locale(voices[voice][1]);
    document.body.classList.toggle('single-language', language !== '全部');
    $('language-tabs').innerHTML = ['全部', '日语', '英语', '中文'].map(l => {
      const count = allowed.filter(id => l === '全部' || locale(voices[id][1]) === l).length;
      return `<button data-language="${l}" class="${language === l ? 'active' : ''}" aria-pressed="${language === l}" ${count ? '' : 'disabled'}>${l} ${count}</button>`;
    }).join('');
    $('language-tabs').querySelectorAll('button').forEach(button => button.onclick = () => {
      language = button.dataset.language;
      if (language !== '全部' && locale(voices[voice][1]) !== language) voice = allowed.find(id => locale(voices[id][1]) === language);
      renderSelection(); saveSettings();
      $('language-tabs').querySelector(`[data-language="${language}"]`)?.focus({ preventScroll: true });
    });
    $('voice-groups').innerHTML = ['日语', '英语', '中文'].filter(l => language === '全部' || l === language).map(l => {
      const list = allowed.filter(id => locale(voices[id][1]) === l);
      if (!list.length) return '';
      return `<section class="voice-group"><h3>${l} / ${list.length} 段</h3><div class="voice-grid">${list.map(id => `<button class="voice-btn ${voice === id ? 'active' : ''}" data-voice="${id}" aria-pressed="${voice === id}"><span><strong>${voices[id][0]}</strong><small>${l} · ${records.has(character + '/' + id) ? '已试听' : '可试听'}</small></span><span class="check">✓</span></button>`).join('')}</div></section>`;
    }).join('');
    $('voice-groups').querySelectorAll('button').forEach(button => button.onclick = () => { voice = button.dataset.voice; renderSelection(); saveSettings(); $('voice-groups').querySelector(`[data-voice="${voice}"]`)?.focus({ preventScroll: true }); });
  }

  function chooseCharacter(id) {
    if (!Object.hasOwn(characterVoices, id)) return;
    character = id;
    if (!characterVoices[id].includes(voice)) voice = characterVoices[id][0];
    // Keep the selected voice visible when changing characters on a phone.
    if (mobile()) language = locale(voices[voice][1]);
    playbackId++;
    voiceAudio.pause();
    renderSelection(); closeDialog(); saveSettings();
    say(`已切换到${characterInfo()[1]}，共 ${characterVoices[id].length} 段语音。`);
  }

  function renderCharacters() {
    const query = $('character-search').value.trim().toLowerCase();
    let matches = 0;
    $('character-results').innerHTML = [['ATTORNEY', '律师 / DEFENSE'], ['PROSECUTOR', '检察官 / PROSECUTION']].map(([role, label]) => {
      const list = characters.filter(c => c[2] === role && c[1].toLowerCase().includes(query));
      matches += list.length;
      return list.length ? `<h3>${label} · ${list.length}</h3><div class="character-grid">${list.map(c => `<button class="character-choice ${c[0] === character ? 'active' : ''}" data-person="${c[0]}" aria-pressed="${c[0] === character}"><span class="avatar">${avatarMarkup(c[0], c[1])}</span><span><strong>${c[1]}</strong><small>${characterVoices[c[0]].length} 段语音 ${c[0] === character ? '· 已选' : ''}</small></span></button>`).join('')}</div>` : '';
    }).join('');
    if (!matches) $('character-results').innerHTML = '<p class="no-results">没有匹配角色，试试输入姓名中的一个字。</p>';
    $('character-results').querySelectorAll('button').forEach(button => button.onclick = () => chooseCharacter(button.dataset.person));
    warmAvatars();
  }
  function openDialog() {
    previousFocus = document.activeElement;
    $('character-dialog').hidden = false;
    document.body.classList.add('dialog-open');
    $('character-search').value = '';
    renderCharacters(); $('close-dialog').focus({ preventScroll: true });
    $('character-results').scrollTop = 0;
    $('choose-character').setAttribute('aria-expanded', 'true');
  }
  function closeDialog() {
    if ($('character-dialog').hidden) return;
    $('character-dialog').hidden = true;
    document.body.classList.remove('dialog-open');
    $('choose-character').setAttribute('aria-expanded', 'false');
    previousFocus?.focus({ preventScroll: true });
  }

  function readCachedVoice(key) {
    try { const value = localStorage.getItem(cachePrefix + key.replace('/', ':')); return value?.startsWith('data:audio/') ? value : null; } catch { return null; }
  }
  function cacheVoice(key, url) {
    if (location.protocol === 'file:' || window.ObjectionAssets || cacheRequests.has(key)) return;
    const epoch = cacheEpoch;
    const request = fetch(url).then(response => {
      if (!response.ok) throw Error('Audio unavailable');
      return response.blob();
    }).then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    })).then(data => { if (epoch === cacheEpoch) { try { localStorage.setItem(cachePrefix + key.replace('/', ':'), data); } catch { /* Browser HTTP cache remains available. */ } } }).catch(() => {}).finally(() => cacheRequests.delete(key));
    cacheRequests.set(key, request);
  }
  async function trigger(origin = '手动播放') {
    if (Date.now() - lastTrigger < 650) return;
    lastTrigger = Date.now();
    const requestId = ++playbackId;
    const key = character + '/' + voice, name = characterInfo()[1], label = voices[voice][0];
    const url = asset(`sound/${character}/${voice}.mp3`), cached = readCachedVoice(key);
    voiceAudio.src = cached || url;
    // Call play in the click handler, before fetching/caching, to keep mobile user activation.
    const playback = voiceAudio.play();
    if ($('auto-music').checked && queue.length) void playMusic();
    $('burst-image').src = asset(`img/${voice}.png`);
    $('burst-image').alt = label;
    $('burst').classList.add('show');
    clearTimeout(burstTimer); burstTimer = setTimeout(() => $('burst').classList.remove('show'), 650);
    if ($('haptic').checked) { try { navigator.vibrate?.(100); } catch { /* Optional device feedback. */ } }
    if (!cached) cacheVoice(key, url);
    try {
      await playback;
      if (requestId !== playbackId) return;
      records.add(key); renderVoices(); say(`${origin}：${name} · ${label}`);
    } catch (error) {
      if (requestId !== playbackId || error.name === 'AbortError') return;
      say(error.name === 'NotAllowedError' ? '浏览器尚未允许声音，请点击「播放台词」后再使用动作触发。' : '这段语音未能载入，请检查网络后重试。');
    }
  }
  function clearAudioCache() {
    cacheEpoch++;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i); if (key?.startsWith(cachePrefix)) localStorage.removeItem(key);
      }
    } catch { /* Restricted storage does not block the action. */ }
    records.clear(); renderVoices(); say('已清除语音缓存和试听记录，角色语音仍可正常播放。');
  }

  function updateMotion(event) {
    let acceleration = event.acceleration;
    if (!acceleration || [acceleration.x, acceleration.y, acceleration.z].every(v => v == null)) {
      const raw = event.accelerationIncludingGravity;
      if (!raw) return;
      const values = [raw.x, raw.y, raw.z].map(v => Number(v) || 0);
      if (!gravity) { gravity = values; return; }
      const linear = values.map((value, index) => { gravity[index] = gravity[index] * 0.8 + value * 0.2; return value - gravity[index]; });
      acceleration = { x: linear[0], y: linear[1], z: linear[2] };
    }
    const values = [acceleration.x, acceleration.y, acceleration.z].map(v => Number(v) || 0);
    ['sx', 'sy', 'sz'].forEach((id, index) => $(id).textContent = 'XYZ'[index] + ' ' + values[index].toFixed(2));
    const maximum = Math.max(...values.map(Math.abs)); peak = Math.max(peak, maximum);
    $('peak').textContent = '峰值 ' + peak.toFixed(2);
    if (maximum >= threshold && $('character-dialog').hidden && document.visibilityState === 'visible') void trigger('动作触发');
  }
  function sensorUi() {
    $('arm').textContent = armed ? '⌁ 停止动作触发' : '⌁ 开启动作触发';
    $('arm').classList.toggle('on', armed); $('arm').setAttribute('aria-pressed', String(armed));
    $('stage-status').textContent = armed ? '● 动作感应已开启' : '● 等待发声';
  }
  function stopMotion() { window.removeEventListener('devicemotion', updateMotion); armed = false; gravity = null; sensorUi(); }
  async function toggleMotion() {
    if (motionPending) return;
    if (armed) { stopMotion(); say('已关闭动作触发。'); return; }
    motionPending = true; $('arm').disabled = true;
    try {
      if (!('DeviceMotionEvent' in window)) throw Error('此浏览器未提供动作感应，可在设置中点击「模拟挥动」。');
      if (!isSecureContext) throw Error('动作感应需要 HTTPS；你仍可以点击按钮播放台词。');
      if (typeof DeviceMotionEvent.requestPermission === 'function' && await DeviceMotionEvent.requestPermission() !== 'granted') throw Error('动作感应未获授权，可以继续点击按钮播放。');
      gravity = null; window.addEventListener('devicemotion', updateMotion); armed = true; sensorUi();
      say('已启用动作感应。请先点击播放台词开启声音；没有响应时可调低触发阈值。');
    } catch (error) { say(error.message); }
    finally { motionPending = false; $('arm').disabled = false; }
  }
  function updateThreshold() { threshold = Number($('sensitivity').value); $('threshold-value').textContent = threshold.toFixed(1); $('threshold-summary').textContent = '阈值 ' + threshold.toFixed(1); }
  function resetPeak() { peak = 0; $('peak').textContent = '峰值 0.00'; }
  function setFocus(on) { document.body.classList.toggle('focus-mode', on); renderPortrait(characterInfo()[1]); (on ? $('restore') : $('focus')).focus({ preventScroll: true }); }

  function formatTime(value) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '--:--'; }
  function musicButton() { $('music-play').textContent = musicAudio.paused ? '▷ 播放音乐' : 'Ⅱ 暂停音乐'; }
  function musicProgress() {
    $('music-time').textContent = `${formatTime(musicAudio.currentTime)} / ${formatTime(musicAudio.duration)}`;
    if (Number.isFinite(musicAudio.duration) && musicAudio.duration > 0) $('music-seek').value = musicAudio.currentTime / musicAudio.duration * 1000;
  }
  function loadTrack(index) {
    if (!queue.length) return;
    track = (index + queue.length) % queue.length;
    musicAudio.pause(); musicAudio.removeAttribute('src'); musicAudio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(queue[track]); musicAudio.src = objectUrl;
    musicAudio.loop = queue.length === 1 && $('music-loop').checked;
    $('track-name').textContent = `${track + 1}/${queue.length} · ${queue[track].name}`;
    $('music-summary').textContent = `${queue.length} 首已选`;
    $('music-play').disabled = false; $('music-next').disabled = queue.length < 2; $('music-clear').disabled = false;
    $('music-seek').disabled = false; $('music-seek').value = 0; musicProgress();
    $('music-status').textContent = '音乐已载入，点击播放即可。';
  }
  async function playMusic() {
    if (!queue.length) { $('music-status').textContent = '请先从设备里选择音乐。'; return; }
    try { await musicAudio.play(); }
    catch (error) { if (error.name !== 'AbortError') $('music-status').textContent = error.name === 'NotAllowedError' ? '请点击「播放音乐」开启声音。' : '无法播放此文件，请试试 MP3 / M4A。'; }
  }
  function clearMusic() {
    musicAudio.pause(); musicAudio.removeAttribute('src'); musicAudio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = ''; queue = []; track = 0; $('music-files').value = '';
    $('track-name').textContent = '未选择音乐'; $('music-summary').textContent = '尚未选择';
    ['music-play', 'music-next', 'music-clear', 'music-seek'].forEach(id => $(id).disabled = true);
    $('music-seek').value = 0; $('music-time').textContent = '--:-- / --:--';
    $('music-status').textContent = '歌单已清空，设备里的音乐文件不会被删除。';
  }

  $('portrait').onerror = hidePortrait;
  matchMedia('(max-width:740px)').addEventListener('change', () => renderPortrait(characterInfo()[1]));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !portraitLoading) warmPortraits(); });
  // A failed thumbnail leaves the readable surname monogram underneath.
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && event.target.closest('.avatar')) event.target.remove();
  }, true);
  $('choose-character').onclick = openDialog; $('close-dialog').onclick = closeDialog;
  $('character-search').oninput = renderCharacters;
  $('character-results').addEventListener('scroll', warmAvatars, { passive: true });
  $('character-dialog').onclick = event => { if (event.target === $('character-dialog')) closeDialog(); };
  $('play').onclick = () => void trigger(); $('arm').onclick = toggleMotion;
  $('simulate').onclick = () => void trigger('模拟挥动'); $('reset-peak').onclick = resetPeak;
  $('sensitivity').value = threshold; updateThreshold();
  $('sensitivity').oninput = () => { updateThreshold(); saveSettings(); };
  $('mouse-mode').checked = mouse;
  $('mouse-mode').onchange = () => { mouse = $('mouse-mode').checked; saveSettings(); say(mouse ? '桌面鼠标触发已开启。' : '桌面鼠标触发已关闭。'); };
  $('haptic').checked = settings.haptic !== false;
  $('haptic').onchange = saveSettings; $('auto-music').checked = Boolean(settings.autoMusic); $('auto-music').onchange = saveSettings;
  $('focus').onclick = () => setFocus(true); $('restore').onclick = () => setFocus(false);
  $('court').ondblclick = () => setFocus(!document.body.classList.contains('focus-mode'));
  $('clear-records').onclick = clearAudioCache;
  $('reset-settings').onclick = () => {
    stopMotion(); mouse = false; $('mouse-mode').checked = false; $('haptic').checked = true;
    $('auto-music').checked = false; $('music-loop').checked = true; $('music-volume').value = 0.7;
    musicAudio.volume = 0.7; musicAudio.loop = queue.length === 1;
    $('sensitivity').value = 5; updateThreshold(); resetPeak(); saveSettings(); say('动作、震动和音乐偏好已恢复默认。');
  };
  document.addEventListener('keydown', event => {
    if (!$('character-dialog').hidden) {
      if (event.key === 'Escape') closeDialog();
      if (event.key === 'Tab') {
        const list = [...$('character-dialog').querySelectorAll('button:not(:disabled),input')];
        const first = list[0], last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) setFocus(false);
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault(); mouse = !mouse; $('mouse-mode').checked = mouse; saveSettings(); say(mouse ? '桌面鼠标触发已开启。' : '桌面鼠标触发已关闭。');
    }
  });
  document.addEventListener('mousemove', event => { if (mouse && event.target.closest('#court') && $('character-dialog').hidden && Date.now() - lastTrigger > 1800) void trigger('鼠标触发'); });
  $('music-files').onchange = event => {
    const selected = [...event.target.files]; event.target.value = '';
    if (!selected.length) return;
    const supported = selected.filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name));
    if (!supported.length) { $('music-status').textContent = '没有找到音频文件，请选择 MP3 / M4A 等音频。'; return; }
    queue = supported; loadTrack(0);
  };
  $('music-play').onclick = () => { if (musicAudio.paused) void playMusic(); else musicAudio.pause(); };
  $('music-next').onclick = () => { if (queue.length > 1) { loadTrack(track + 1); void playMusic(); } };
  $('music-clear').onclick = clearMusic;
  musicAudio.onplaying = () => { musicButton(); $('music-status').textContent = '正在播放'; };
  musicAudio.onpause = () => { musicButton(); if (queue.length) $('music-status').textContent = '已暂停'; };
  musicAudio.onended = () => {
    if (queue.length && (track + 1 < queue.length || $('music-loop').checked)) { loadTrack(track + 1); void playMusic(); }
    else { musicButton(); $('music-status').textContent = '播放完成'; }
  };
  musicAudio.onerror = () => { if (queue.length) $('music-status').textContent = '无法播放此文件，请试试 MP3 / M4A。'; };
  musicAudio.onloadedmetadata = musicProgress; musicAudio.ontimeupdate = musicProgress;
  $('music-loop').checked = settings.musicLoop !== false;
  $('music-loop').onchange = () => { musicAudio.loop = queue.length === 1 && $('music-loop').checked; saveSettings(); };
  $('music-volume').value = clamp(settings.musicVolume, 0, 1, 0.7); musicAudio.volume = Number($('music-volume').value);
  $('music-volume').oninput = () => { musicAudio.volume = Number($('music-volume').value); saveSettings(); };
  $('music-seek').oninput = () => { if (Number.isFinite(musicAudio.duration) && musicAudio.duration > 0) musicAudio.currentTime = musicAudio.duration * Number($('music-seek').value) / 1000; };
  window.addEventListener('beforeunload', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
  renderSelection(); sensorUi();
})();
