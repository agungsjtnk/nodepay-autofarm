import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';

const logger = log4js.getLogger();

// Sisa kode tetap sama

const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const logger = require('log4js').getLogger();

// Constants
const NP_TOKEN = "WRITE_YOUR_NP_TOKEN_HERE";
const PING_INTERVAL = 30000; // 30 seconds
const RETRIES_LIMIT = 60; // Global retry counter for ping failures

const DOMAIN_API = {
  SESSION: "https://api.nodepay.ai/api/auth/session",
  PING: "https://nw2.nodepay.ai/api/network/ping"
};

const CONNECTION_STATES = {
  CONNECTED: 1,
  DISCONNECTED: 2,
  NONE_CONNECTION: 3
};

let statusConnect = CONNECTION_STATES.NONE_CONNECTION;
let tokenInfo = NP_TOKEN;
let browserId = null;
let accountInfo = {};

function validResp(resp) {
  if (!resp || !resp.code || resp.code < 0) {
    throw new Error("Invalid response");
  }
  return resp;
}

async function renderProfileInfo(proxy) {
  try {
    const npSessionInfo = loadSessionInfo(proxy);

    if (!npSessionInfo) {
      const response = await callApi(DOMAIN_API.SESSION, {}, proxy);
      validResp(response);
      accountInfo = response.data;
      if (accountInfo.uid) {
        saveSessionInfo(proxy, accountInfo);
        await startPing(proxy);
      } else {
        handleLogout(proxy);
      }
    } else {
      accountInfo = npSessionInfo;
      await startPing(proxy);
    }
  } catch (error) {
    logger.error(`Error in renderProfileInfo for proxy ${proxy}: ${error.message}`);
    if (error.message.includes("500 Internal Server Error")) {
      logger.info(`Removing error proxy from the list: ${proxy}`);
      removeProxyFromList(proxy);
      return null;
    } else {
      logger.error(`Connection error: ${error.message}`);
      return proxy;
    }
  }
}

async function callApi(url, data, proxy) {
  const headers = {
    "Authorization": `Bearer ${tokenInfo}`,
    "Content-Type": "application/json"
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
      agent: proxy ? new HttpsProxyAgent(proxy) : null
    });

    if (!response.ok) {
      throw new Error(`Failed API call to ${url}`);
    }

    const jsonResponse = await response.json();
    return validResp(jsonResponse);
  } catch (error) {
    logger.error(`Error during API call: ${error.message}`);
    throw error;
  }
}

async function startPing(proxy) {
  try {
    await ping(proxy);
    setInterval(async () => {
      await ping(proxy);
    }, PING_INTERVAL);
  } catch (error) {
    logger.error(`Error in startPing for proxy ${proxy}: ${error.message}`);
  }
}

async function ping(proxy) {
  let retries = 0;

  try {
    const data = {
      id: accountInfo.uid,
      browser_id: browserId,
      timestamp: Math.floor(Date.now() / 1000)
    };

    const response = await callApi(DOMAIN_API.PING, data, proxy);
    if (response.code === 0) {
      logger.info(`Ping successful via proxy ${proxy}`);
      retries = 0;
      statusConnect = CONNECTION_STATES.CONNECTED;
    } else {
      handlePingFail(proxy, response);
    }
  } catch (error) {
    logger.error(`Ping failed via proxy ${proxy}: ${error.message}`);
    handlePingFail(proxy, null);
  }
}

function handlePingFail(proxy, response) {
  if (response && response.code === 403) {
    handleLogout(proxy);
  } else {
    statusConnect = CONNECTION_STATES.DISCONNECTED;
  }
}

function handleLogout(proxy) {
  tokenInfo = null;
  statusConnect = CONNECTION_STATES.NONE_CONNECTION;
  accountInfo = {};
  saveStatus(proxy, null);
  logger.info(`Logged out and cleared session info for proxy ${proxy}`);
}

function loadSessionInfo(proxy) {
  // Implement session loading logic here
  return {};
}

function saveSessionInfo(proxy, data) {
  // Implement session saving logic here
}

function isValidProxy(proxy) {
  // Validate proxy format or connection here
  return true;
}

function removeProxyFromList(proxy) {
  // Implement logic to remove proxy from the list
}

async function main() {
  const allProxies = loadProxies('proxy.txt');
  let activeProxies = allProxies.slice(0, 100).filter(isValidProxy);

  const tasks = new Map();
  for (const proxy of activeProxies) {
    tasks.set(renderProfileInfo(proxy), proxy);
  }

  while (true) {
    const [doneTask] = await Promise.race(tasks.keys());
    const failedProxy = tasks.get(doneTask);

    if ((await doneTask) === null) {
      logger.info(`Removing and replacing failed proxy: ${failedProxy}`);
      activeProxies = activeProxies.filter(p => p !== failedProxy);
      const newProxy = allProxies.shift();
      if (newProxy && isValidProxy(newProxy)) {
        activeProxies.push(newProxy);
        tasks.set(renderProfileInfo(newProxy), newProxy);
      }
    }
    tasks.delete(doneTask);

    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds before next task
  }
}

function loadProxies(proxyFile) {
  // Implement logic to load proxies from file
  return [];
}

process.on('SIGINT', () => {
  logger.info("Program terminated by user.");
  process.exit();
});

main();
