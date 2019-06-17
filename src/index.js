import EmbarkJSPlasma from "embarkjs-omg";
import { dappPath } from "embark-utils";
import { formatDate } from "./utils";

// Service check constants
const SERVICE_CHECK_ON = "on";
const SERVICE_CHECK_OFF = "off";

/**
 * Plugin that allows Embark to connect to and interact with an existing Plama chain,
 * and provides an EmbarkJS.Plasma API to allow the DApp to interact with the chain.
 */
class EmbarkPlasma extends EmbarkJSPlasma {
  constructor(embark) {
    super(embark);

    this.embark = embark;
    this.events = embark.events;
    this.pluginConfig = embark.pluginConfig;
    this.accounts = [];

    // gets hydrated blockchain config from embark, use it to init
    this.events.once("config:load:contracts", this.addCodeToEmbarkJs.bind(this));
    this.registerServiceCheck();
    this.registerConsoleCommands();

    this.events.request("blockchain:get", (web3) => {
      this.events.request("blockchain:ready", () => {
        this.init(web3, true);
      });
    });
  }

  generateSymlink(varName, location) {
    return new Promise((resolve, reject) => {
      this.events.request("code-generator:symlink:generate", location, varName, (err, symlinkDest) => {
        if (err) {
          return reject(err);
        }
        resolve(symlinkDest);
      });
    });
  }

  codeGeneratorReady() {
    return new Promise((resolve, _reject) => {
      this.events.request("code-generator:ready", () => {
        resolve();
      });
    });
  }

  async addCodeToEmbarkJs() {
    const nodePath = dappPath("node_modules");
    const embarkjsOmgPath = require.resolve("embarkjs-omg", {
      paths: [nodePath]
    });
    let embarkJsOmgSymlinkPath;

    await this.codeGeneratorReady();
    try {
      embarkJsOmgSymlinkPath = await this.generateSymlink("embarkjs-omg", embarkjsOmgPath);
    } catch (err) {
      this.logger.error(__("Error creating a symlink to embarkjs-omg"));
      return this.logger.error(err.message || err);
    }

    this.events.emit("runcode:register", "embarkjsOmg", require("embarkjs-omg"), () => {
      let code = "";
      code += `\nlet __embarkPlasma = global.embarkjsOmg || require('${embarkJsOmgSymlinkPath}').default;`;
      //code += `\nWeb3 = global.embarkjsOmg || require('${embarkJsOmgSymlinkPath}').default;`;
      code += `\nconst opts = {
            logger: {
              info: console.log,
              warn: console.warn,
              error: console.error,
              trace: console.trace
            },
            pluginConfig: ${JSON.stringify(this.pluginConfig)}
          };`;
      code += "\nEmbarkJS.onReady(() => {";
      code += "\n  EmbarkJS.Plasma = new __embarkPlasma(opts);";
      // code += `\n  EmbarkJS.Plasma.init(${JSON.stringify(this.accounts)}, "${web3SymlinkPath}");`;
      code += `\n  const embarkJsWeb3Provider = EmbarkJS.Blockchain.Providers["web3"]`;
      code += `\n  if (!embarkJsWeb3Provider) { throw new Error("web3 cannot be found. Please ensure you have the 'embarkjs-connector-web3' plugin installed in your DApp."); }`;
      code += `\n  if (global.embarkjsOmg) EmbarkJS.Plasma.init(embarkJsWeb3Provider.web3, true).catch((err) => console.error(err));`; // global.embarkjsOmg ? "${web3SymlinkPath}" : null);`; // pass the symlink path ONLY when we are in the node (VM) context
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
          const message = "The Plasma chain is already initialized. If you'd like to reinitialize the chain, use the --force option ('plasma init --force').";
          this.logger.error(message);
          return callback(message); // passes a message back to cockpit console
        }
        this.init()
          .then(message => {
            this.logger.info(message);
            callback(null, message);
          })
          .catch(e => {
            this.logger.error(e.message);
            callback(e.message);
          });
      }
    });

    const depositRegex = /^plasma[\s]+deposit[\s]+([0-9]+)$/;
    this.embark.registerConsoleCommand({
      description: "Deposits ETH (or ERC20) from the root chain to the Plasma child chain to be used for transacting on the Plasma chain.",
      matches: cmd => {
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
          .then(message => {
            this.logger.info(message);
            callback(null, message);
          })
          .catch(e => {
            this.logger.error(e.message);
            callback(e.message);
          });
      }
    });

    const sendRegex = /^plasma[\s]+transfer[\s]+(0x[0-9,a-f,A-F]{40,40})[\s]+([0-9]+)$/;
    this.embark.registerConsoleCommand({
      description: "Sends an ETH tx on the Plasma chain from the account configured in the DApp's blockchain configuration to any other account on the Plasma chain.",
      matches: cmd => {
        return sendRegex.test(cmd);
      },
      usage: "plasma transfer [to_address] [amount]",
      process: (cmd, callback) => {
        if (!this.inited) {
          return callback("The Plasma chain has not been initialized. Please initialize the Plamsa chain using 'plasma init' before continuting."); // passes a message back to cockpit console
        }
        const matches = cmd.match(sendRegex) || [];
        if (matches.length <= 2) {
          return callback("Invalid command format, please use the format 'plasma transfer [to_address] [amount]', ie 'plasma transfer 0x38d5beb778b6e62d82e3ba4633e08987e6d0f990 555'");
        }
        this.transfer(matches[1], matches[2])
          .then(message => {
            this.logger.info(message);
            callback(null, message);
          })
          .catch(e => {
            this.logger.error(e.message);
            callback(e.message);
          });
      }
    });

    const exitRegex = /^plasma[\s]+exit[\s]+(0x[0-9,a-f,A-F]{40,40})$/;
    this.embark.registerConsoleCommand({
      description: "Exits all UTXO's from the Plasma chain to the root chain.",
      matches: cmd => {
        return exitRegex.test(cmd);
      },
      usage: "plasma exit [plasma_chain_address]",
      process: (cmd, callback) => {
        if (!this.inited) {
          const message = "The Plasma chain has not been initialized. Please initialize the Plamsa chain using 'plasma init' before continuting.";
          this.logger.error(message);
          return callback(message); // passes a message back to cockpit console
        }
        const matches = cmd.match(exitRegex) || [];
        if (matches.length <= 1) {
          const message = "Invalid command format, please use the format 'plasma exit [plasma_chain_address]', ie 'plasma exit 0x38d5beb778b6e62d82e3ba4633e08987e6d0f990'";
          this.logger.error(message);
          return callback(message);
        }
        this.exitAllUtxos(matches[1])
          .then(message => {
            this.logger.info(message);
            callback(null, message);
          })
          .catch(e => {
            this.logger.error(e.message);
            callback(e.message);
          });
      }
    });

    this.embark.registerConsoleCommand({
      description: "Gets the status of the Plasma chain.",
      matches: ["plasma status"],
      process: (cmd, callback) => {
        this.childChain.status()
          .then(status => {
            this.logger.info(status);
            callback(null, status);
          })
          .catch(e => {
            this.logger.error(e.message);
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

    this.events.request(
      "services:register",
      name,
      cb => {
        if (!this.inited) {
          return cb({ name: "Loading...", status: SERVICE_CHECK_OFF });
        }
        this.childChain.status()
          .then(status => {
            const serviceStatus = `Last block: ${formatDate(status.last_mined_child_block_timestamp)}`;
            return cb({
              name: serviceStatus,
              status: status ? SERVICE_CHECK_ON : SERVICE_CHECK_OFF
            });
          })
          .catch(err => {
            return cb(err);
          });
      },
      5000,
      "off"
    );

    this.events.on("check:backOnline:OmiseGO", () => {
      this.logger.info("------------------");
      this.logger.info("Connected to the Plama chain!");
      this.logger.info("------------------");
    });

    this.events.on("check:wentOffline:OmiseGO", () => {
      this.logger.error("------------------");
      this.logger.error("Couldn't connect or lost connection to the Plasma chain...");
      this.logger.error("------------------");
    });
  }
}

export default EmbarkPlasma;
