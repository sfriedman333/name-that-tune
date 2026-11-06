(() => {
  const socket = io({ transports: ['websocket', 'polling'] });

  const $ = (id) => document.getElementById(id);
  const screenHome = $('screen-home');
  const screenGame = $('screen-game');
  const nameInput = $('nameInput');
  const codeInput = $('codeInput');
  const homeError = $('homeError');
  const auddBadge = $('auddBadge');
  const roomCodeEl = $('roomCode');
  const roundNum = $('roundNum');
  const phaseBanner = $('phaseBanner');
  const playerList = $('playerList');
  const hostPanel = $('hostPanel');
  const guessPanel = $('guessPanel');
  const guessInput = $('guessInput');
  const guessFeedback = $('guessFeedback');
  const resultCard = $('resultCard');
  const winnerLine = $('winnerLine');
  const trackLine = $('trackLine');
  const listenStatus = $('listenStatus');
  const listenText = $('listenText');
  const btnNext = $('btnNext');
  const modal = $('modal');
  const modalTitle = $('modalTitle');
  const modalHint = $('modalHint');
  const modalTitleInput = $('modalTitleInput');
  const modalArtistInput = $('modalArtistInput');

  let state = null;
  let modalMode = 'demo'; // demo | manual
  let mediaRecorder = null;
  let recordingChunks = [];
  let hasAudd = false;

  // Restore name
  try {
    const saved = localStorage.getItem('ntt_name');
    if (saved) nameInput.value = saved;
  } catch (_) {}

  function showError(msg) {
    homeError.hidden = !msg;
    homeError.textContent = msg || '';
  }

  function saveName() {
    const n = nameInput.value.trim();
    try { if (n) localStorage.setItem('ntt_name', n); } catch (_) {}
    return n || 'Player';
  }

  function setAuddBadge(on) {
    hasAudd = !!on;
    auddBadge.textContent = on ? 'AudD live ID' : 'Demo / manual mode';
    auddBadge.classList.toggle('on', !!on);
  }

  function renderPlayers(players) {
    playerList.innerHTML = '';
    const sorted = [...(players || [])].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    for (const p of sorted) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.innerHTML = `<span class="name"></span>`;
      left.querySelector('.name').textContent = p.name;
      if (p.isHost) {
        const tag = document.createElement('span');
        tag.className = 'host-tag';
        tag.textContent = 'HOST';
        left.appendChild(tag);
      }
      const score = document.createElement('div');
      score.className = 'score';
      score.textContent = String(p.score);
      li.appendChild(left);
      li.appendChild(score);
      playerList.appendChild(li);
    }
  }

  function applyState(s) {
    state = s;
    if (!s) return;
    screenHome.hidden = true;
    screenGame.hidden = false;
    roomCodeEl.textContent = s.code;
    roundNum.textContent = String(s.round || 0);
    renderPlayers(s.players);
    hostPanel.hidden = !s.youAreHost;
    setAuddBadge(s.hasAudd);

    const phase = s.phase || 'lobby';
    phaseBanner.className = 'phase ' + phase;
    const labels = {
      lobby: 'Waiting in lobby — host starts a round',
      listening: 'Listening for the song…',
      ready: 'Identified — GO!',
      guessing: 'Name that tune!',
      revealed: s.winner ? `${s.winner.name} won!` : 'Round over',
    };
    phaseBanner.textContent = s.prompt || labels[phase] || phase;

    const guessing = phase === 'guessing' || phase === 'ready';
    guessPanel.hidden = !guessing;
    if (guessing) {
      guessInput.disabled = phase === 'ready';
      $('btnGuess').disabled = phase === 'ready';
      if (phase === 'guessing') {
        setTimeout(() => guessInput.focus(), 50);
      }
    }

    if (phase === 'revealed' && s.track) {
      resultCard.hidden = false;
      winnerLine.textContent = s.winner
        ? `🏆 ${s.winner.name} named it!`
        : 'Round over';
      trackLine.textContent = `${s.track.title}${s.track.artist ? ' — ' + s.track.artist : ''}`;
      btnNext.hidden = !s.youAreHost;
    } else {
      resultCard.hidden = true;
      btnNext.hidden = true;
    }

    if (phase !== 'listening') {
      listenStatus.hidden = true;
    }
  }

  function openModal(mode) {
    modalMode = mode;
    modal.hidden = false;
    modalTitleInput.value = '';
    modalArtistInput.value = '';
    if (mode === 'demo') {
      modalTitle.textContent = 'Demo round';
      modalHint.textContent = 'Enter the secret answer. Everyone else races to type the song title. Great for a plane or quiet hotel.';
    } else {
      modalTitle.textContent = 'Manual reveal';
      modalHint.textContent = 'You know what’s playing — paste the title so the race can start without AudD.';
    }
    setTimeout(() => modalTitleInput.focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
  }

  $('btnCreate').addEventListener('click', () => {
    showError('');
    const name = saveName();
    socket.emit('room:create', { name }, (res) => {
      if (!res?.ok) return showError(res?.error || 'Could not create room');
      applyState(res.state);
    });
  });

  $('btnJoin').addEventListener('click', () => {
    showError('');
    const name = saveName();
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return showError('Enter a room code');
    socket.emit('room:join', { code, name }, (res) => {
      if (!res?.ok) return showError(res?.error || 'Could not join');
      applyState(res.state);
    });
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btnJoin').click();
  });

  $('btnDemo').addEventListener('click', () => openModal('demo'));
  $('btnManual').addEventListener('click', () => openModal('manual'));
  $('modalCancel').addEventListener('click', closeModal);
  $('modalConfirm').addEventListener('click', () => {
    const title = modalTitleInput.value.trim();
    const artist = modalArtistInput.value.trim();
    if (!title) {
      modalTitleInput.focus();
      return;
    }
    const event = modalMode === 'demo' ? 'round:demo' : 'round:manual';
    socket.emit(event, { title, artist }, (res) => {
      if (!res?.ok) {
        alert(res?.error || 'Failed');
        return;
      }
      closeModal();
    });
  });

  $('btnNext').addEventListener('click', () => {
    socket.emit('round:next');
  });

  $('btnGuess').addEventListener('click', submitGuess);
  guessInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuess();
  });

  function submitGuess() {
    const guess = guessInput.value.trim();
    if (!guess) return;
    guessFeedback.textContent = '';
    guessFeedback.className = 'feedback';
    socket.emit('guess:submit', { guess }, (res) => {
      if (!res?.ok) {
        guessFeedback.textContent = res?.error || 'Error';
        return;
      }
      if (res.correct) {
        guessFeedback.textContent = 'Correct!';
        guessFeedback.className = 'feedback ok';
        guessInput.value = '';
      } else {
        guessFeedback.textContent = res.message || 'Nope — try again!';
        guessInput.select();
      }
    });
  }

  $('btnListen').addEventListener('click', async () => {
    if (!hasAudd) {
      alert('No AudD API token on the server yet. Use Demo round or Manual reveal. To enable live ID, set AUDD_API_TOKEN and restart.');
      return;
    }
    try {
      listenStatus.hidden = false;
      listenText.textContent = 'Requesting mic…';
      socket.emit('round:listening');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      recordingChunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunks.push(e.data);
      };

      const stopped = new Promise((resolve) => {
        mediaRecorder.onstop = resolve;
      });

      listenText.textContent = 'Listening… hold phone toward the speaker';
      mediaRecorder.start(250);
      await wait(6500);
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());

      listenText.textContent = 'Identifying…';
      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      form.append('audio', blob, `clip.${ext}`);

      const resp = await fetch('/api/identify', { method: 'POST', body: form });
      const data = await resp.json();
      if (data.ok && data.title) {
        listenText.textContent = 'Got it!';
        socket.emit('round:identified', {
          title: data.title,
          artist: data.artist,
          album: data.album,
        });
        setTimeout(() => { listenStatus.hidden = true; }, 600);
      } else {
        listenStatus.hidden = true;
        socket.emit('round:listen-failed', {
          message: data.message || 'Could not identify. Try Manual reveal.',
        });
        alert(data.message || 'Could not identify the track. Try again closer to the speaker, or use Manual reveal.');
      }
    } catch (err) {
      console.error(err);
      listenStatus.hidden = true;
      socket.emit('round:listen-failed', { message: 'Mic failed: ' + (err.message || err) });
      alert('Microphone error: ' + (err.message || err) + '\n\nOn iPhone Safari, allow mic access and use HTTPS.');
    }
  });

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  socket.on('hello', (msg) => setAuddBadge(msg.hasAudd));
  socket.on('room:state', applyState);
  socket.on('round:go', () => {
    guessFeedback.textContent = '';
    guessInput.value = '';
    guessInput.focus();
  });
  socket.on('round:won', () => {
    // state update follows via room:state
  });
  socket.on('toast', (t) => {
    if (t?.message) {
      // light UX
      guessFeedback.textContent = t.message;
    }
  });

  socket.on('connect_error', () => showError('Cannot reach game server'));
})();
