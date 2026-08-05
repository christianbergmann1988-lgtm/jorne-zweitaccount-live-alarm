import { readFile, writeFile } from 'node:fs/promises';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const USERNAME = 'feliiiocean';
const STATE_FILE = 'state.json';

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error('BOT_TOKEN oder CHAT_ID fehlt.');
}

async function telegramRequest(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram-Fehler bei ${method}: ${JSON.stringify(result)}`
    );
  }

  return result.result;
}

async function readState() {
  try {
    const content = await readFile(STATE_FILE, 'utf8');
    const state = JSON.parse(content);

    return {
      live: Boolean(state.live),
      messageId: Number.isInteger(state.messageId)
        ? state.messageId
        : null
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        live: false,
        messageId: null
      };
    }

    throw error;
  }
}

async function writeState(state) {
  await writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2) + '\n',
    'utf8'
  );
}

async function sendLiveMessage() {
  const message = await telegramRequest('sendMessage', {
    chat_id: CHAT_ID,
    text:
      `🔴 Jorne ist jetzt LIVE auf TikTok!\n\n` +
      `👉 Direkt zum Live:\n` +
      `https://www.tiktok.com/@${USERNAME}/live`
  });

  return message.message_id;
}

async function deleteLiveMessage(messageId) {
  if (!messageId) {
    console.log('Keine gespeicherte Live-Nachricht vorhanden.');
    return;
  }

  try {
    await telegramRequest('deleteMessage', {
      chat_id: CHAT_ID,
      message_id: messageId
    });

    console.log('Die Live-Nachricht wurde aus Telegram gelöscht.');
  } catch (error) {
    console.warn(
      `Die Live-Nachricht konnte nicht gelöscht werden: ${error.message}`
    );
  }
}

function withTimeout(promise, milliseconds) {
  let timeout;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(
        `TikTok antwortet nach ${milliseconds / 1000} Sekunden nicht.`
      );
      error.name = 'TimeoutError';
      reject(error);
    }, milliseconds);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

async function main() {
  const oldState = await readState();

  const connection = new TikTokLiveConnection(USERNAME, {});

  let isLive;

  try {
    console.log(`Prüfe TikTok-Status von @${USERNAME} ...`);

    isLive = await withTimeout(
      connection.fetchIsLive(),
      20000
    );
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.warn(error.message);
      console.warn(
        'Dieser Durchlauf wird beendet. Der nächste Check versucht es erneut.'
      );
      return;
    }

    throw error;
  } finally {
    try {
      await connection.disconnect();
    } catch {
      // Keine aktive Verbindung vorhanden.
    }
  }

  console.log(
    `TikTok-Status von @${USERNAME}: ${isLive ? 'LIVE' : 'offline'}`
  );

  if (isLive) {
    if (oldState.live && oldState.messageId) {
      console.log(
        'Jorne ist weiterhin live. Keine neue Nachricht erforderlich.'
      );
      return;
    }

    const messageId = await sendLiveMessage();

    await writeState({
      live: true,
      messageId
    });

    console.log(
      `Live-Nachricht wurde mit der ID ${messageId} gespeichert.`
    );

    return;
  }

  if (oldState.live || oldState.messageId) {
    await deleteLiveMessage(oldState.messageId);

    await writeState({
      live: false,
      messageId: null
    });

    console.log(
      'Offline erkannt. Live-Nachricht entfernt und Status zurückgesetzt.'
    );

    return;
  }

  console.log(
    'Jorne ist weiterhin offline. Keine Telegram-Nachricht erforderlich.'
  );
}

main()
  .then(() => {
    console.log('✅ Live-Check abgeschlossen.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Live-Check fehlgeschlagen:', error);
    process.exit(1);
  });
