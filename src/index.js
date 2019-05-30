import EmbarkJSOmg from "embarkjs-omg";
import EmbarkUtils from "./utils/embark";
import { dappPath } from "embark-utils";
import { formatDate } from "./utils";
import { getWatcherStatus } from "./utils/plasma";
import { waterfall } from "async";

// Service check constants
const SERVICE_CHECK_ON = 'on';
const SERVICE_CHECK_OFF = 'off';

/**
 * Plugin that allows Embark to connect to and interact with an existing Plama chain, 
 * and provides an EmbarkJS.Plasma API to allow the DApp to interact with the chain.
 */
class EmbarkOmg extends EmbarkJSOmg {
  constructor(embark) {
    super(embark);

    this.embark = embark;
    this.events = embark.events;
    this.pluginConfig = embark.pluginConfig;
    this.accounts = [];

    // gets hydrated blockchain config from embark, use it to init
    this.events.once('config:load:blockchain', (blockchainConfig) => {
      this.logger.info("blockchain config loaded...");
      this.embarkUtils = new EmbarkUtils({ events: this.events, logger: this.logger, blockchainConfig });

      this.init().then(() => {
        this.addCodeToEmbarkJs();
      });
    });

    this.registerServiceCheck();
    this.registerConsoleCommands();
  }

  async init() {
    // init account used for root and child chains
    try {
      const accounts = await this.embarkUtils.accounts;
      this.accounts = accounts;
    } catch (e) {
      return this.logger.error(`Error getting accounts from Embark's config: ${e}`);
    }
    try {
      this.web3Path = await this.embarkUtils.web3Path;
    }
    catch (e) {
      this.logger.error(`Error getting web3 from Embark: ${e}`);
    }
    try {
      await super.init(this.accounts, this.web3Path);
      this.events.emit("embark-omg:init");
    }
    catch (e) {
      this.logger.error(`Error initializing EmbarkOmg: ${e}`);
    }
  }

  generateSymlink(varName, location) {
    return new Promise((resolve, reject) => {
      this.events.request('code-generator:symlink:generate', location, varName, (err, symlinkDest) => {
        if (err) {
          return reject(err);
        }
        resolve(symlinkDest);
      });
    });
  }

  codeGeneratorReady() {
    return new Promise((resolve, _reject) => {
      this.events.request('code-generator:ready', () => {
        resolve();
      });
    });
  }

  async addCodeToEmbarkJs() {
    const nodePath = dappPath('node_modules');
    const embarkjsOmgPath = require.resolve("embarkjs-omg", { paths: [nodePath] });
    let web3SymlinkPath, embarkJsOmgSymlinkPath;

    await this.codeGeneratorReady();

    // create a symlink to web3 - this is currently the job of the web3 connector, so either this will run
    // first or the connector will overwrite it.
    try {
      web3SymlinkPath = await this.generateSymlink('web3', this.web3Path);
    }
    catch (err) {
      this.logger.error(__('Error creating a symlink to web3'));
      return this.logger.error(err.message || err);
    }
    try {
      embarkJsOmgSymlinkPath = await this.generateSymlink('embarkjs-omg', embarkjsOmgPath);
    }
    catch (err) {
      this.logger.error(__('Error creating a symlink to embarkjs-omg'));
      return this.logger.error(err.message || err);
    }

    this.events.emit('runcode:register', 'embarkjsOmg', require('embarkjs-omg'), () => {
      let code = "";
      code += `\nlet __embarkPlasma = global.embarkjsOmg || require('${embarkJsOmgSymlinkPath}').default;`;
      //code += `\nWeb3 = global.embarkjsOmg || require('${embarkJsOmgSymlinkPath}').default;`;
      code += `\nconst opts = {
            logger: {
              info: console.log,
              error: console.error,
              trace: console.trace
            },
            pluginConfig: ${JSON.stringify(this.pluginConfig)}
          };`;
      code += "\nEmbarkJS.onReady(() => {";
      code += "\n  EmbarkJS.Plasma = new __embarkPlasma(opts);";
      // code += `\n  EmbarkJS.Plasma.init(${JSON.stringify(this.accounts)}, "${web3SymlinkPath}");`;
      code += `\n  EmbarkJS.Plasma.init(${JSON.stringify(this.accounts)}, global.embarkjsOmg ? "${web3SymlinkPath}" : null);`; // pass the symlink path ONLY when we are in the node (VM) context
      code += "\n});";

      this.embark.addCodeToEmbarkJS(code);
    });
  }

  registerConsoleCommands() {
    this.embark.registerConsoleCommand({
      description: `Initialises the Plasma chain using the account configured in the DApp's blockchain configuration. All transactions on the child chain will use this as the 'from' account.`,
      matches: ["plasma init", "plasma init --force"],
      usage: "plasma init [--force]",
      process: (cmd, callback) => {
        const force = cmd.endsWith("--force");
        if (this.inited && !force) {
          return callback("The Plasma chain is already initialized. If you'd like to reinitialize the chain, use the --force option ('plasma init --force')."); // passes a message back to cockpit console
        }
        this.init()
          .then((message) => {
            callback(null, message);
          })
          .catch(callback);
      }
    });

    const depositRegex = /^plasma[\s]+deposit[\s]+([0-9]+)$/;
    this.embark.registerConsoleCommand({
      description: "Deposits ETH from the root chain (Rinkeby) to the Plasma chain to be used for transacting on the Plasma chain.",
      matches: (cmd) => {
        return depositRegex.test(cmd);
      },
      usage: "plasma deposit [amount]",
      process: (cmd, callback) => {
        if (!this.inited) {
          return callback("The Plasma chain has not been initialized. Please initialize the Plamsa chain using 'plasma init' before continuting."); // passes a message back to cockpit console
        }
        const matches = cmd.match(depositRegex) || [];
        if (matches.length <= 1) {
          return callback("Invalid command format, please use the format 'plasma deposit [amount]', ie 'plasma deposit 100000'");
        }
        this.deposit(matches[1])
          .then((message) => {
            callback(null, message);
          })
          .catch(callback);
      }
    });

    const sendRegex = /^plasma[\s]+send[\s]+(0x[0-9,a-f,A-F]{40,40})[\s]+([0-9]+)$/;
    this.embark.registerConsoleCommand({
      description: "Sends an ETH tx on the Plasma chain from the account configured in the DApp's blockchain configuration to any other account on the Plasma chain.",
      matches: (cmd) => {
        return sendRegex.test(cmd);
      },
      usage: "plasma send [to_address] [amount]",
      process: (cmd, callback) => {
        if (!this.inited) {
          return callback("The Plasma chain has not been initialized. Please initialize the Plamsa chain using 'plasma init' before continuting."); // passes a message back to cockpit console
        }
        const matches = cmd.match(sendRegex) || [];
        if (matches.length <= 2) {
          return callback("Invalid command format, please use the format 'plasma send [to_address] [amount]', ie 'plasma send 0x38d5beb778b6e62d82e3ba4633e08987e6d0f990 555'");
        }
        this.send(matches[1], matches[2])
          .then((message) => {
            callback(null, message);
          })
          .catch(callback);
      }
    });

    const exitRegex = /^plasma[\s]+exit[\s]+(0x[0-9,a-f,A-F]{40,40})$/;
    this.embark.registerConsoleCommand({
      description: "Exits the ETH from the Plasma chain to the Rinkeby chain.",
      matches: (cmd) => {
        return exitRegex.test(cmd);
      },
      usage: "plasma exit [plasma_chain_address]",
      process: (cmd, callback) => {
        if (!this.inited) {
          return callback("The Plasma chain has not been initialized. Please initialize the Plamsa chain using 'plasma init' before continuting."); // passes a message back to cockpit console
        }
        const matches = cmd.match(exitRegex) || [];
        if (matches.length <= 1) {
          return callback("Invalid command format, please use the format 'plasma exit [plasma_chain_address]', ie 'plasma exit 0x38d5beb778b6e62d82e3ba4633e08987e6d0f990'");
        }
        this.exit(matches[1]).then((message) => {
          callback(null, message);
        }).catch((e) => {
          callback(e.message);
        });
      }
    });

    this.embark.registerConsoleCommand({
      description: "Gets the status of the Plasma chain.",
      matches: ["plasma status"],
      process: (cmd, callback) => {
        getWatcherStatus(this.pluginConfig.WATCHER_URL).then((status) => {
          callback(null, JSON.stringify(status));
        }).catch((e) => {
          callback(e.message);
        });
      }
    });
  }

  /**
   * Registers this plugin for Embark service checks and sets up log messages for
   * connection and disconnection events. The service check pings the Status app.
   * 
   * @returns {void}
   */
  registerServiceCheck() {
    const name = "OMG Plasma Chain";

    this.events.request("services:register", name, (cb) => {

      waterfall([
        (next) => {
          if (this.inited) {
            return next();
          }
          this.events.once("embark-omg:init", next);
        },
        (next) => {
          // TODO: web3_clientVersion method is currently not implemented in web3.js 1.0
          getWatcherStatus(this.pluginConfig.WATCHER_URL)
            .then((status) => {
              const serviceStatus = `Last block: ${formatDate(status.last_mined_child_block_timestamp)}`;
              next(null, { name: serviceStatus, status: status ? SERVICE_CHECK_ON : SERVICE_CHECK_OFF });
            })
            .catch(next);
        }
      ], (err, statusObj) => {
        if (err) {
          return cb(err);
        }
        cb(statusObj);
      });
    }, 5000, 'off');

    this.events.on('check:backOnline:OmiseGO', () => {
      this.logger.info("------------------");
      this.logger.info("Connected to the Plama chain!");
      this.logger.info("------------------");
    });

    this.events.on('check:wentOffline:OmiseGO', () => {
      this.logger.error("------------------");
      this.logger.error("Couldn't connect or lost connection to the Plasma chain...");
      this.logger.error("------------------");
    });
  }
}

export default EmbarkOmg;
