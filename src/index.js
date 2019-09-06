import EmbarkJSPlasma from "embarkjs-plasma";
import {dappPath} from "embark-utils";
import {formatDate, normalizeUrl} from "./utils";
import Web3 from "web3";

// Service check constants
const SERVICE_CHECK_ON = "on";
const SERVICE_CHECK_OFF = "off";

const STACK_NAME = "Plasma";
const MODULE_NAME = "OMG";
const PACKAGE_NAME = "embarkjs-plasma";

/**
 * Plugin that allows Embark to connect to and interact with an existing Plama chain,
 * and provides an EmbarkJS.Plasma API to allow the DApp to interact with the chain.
 */
class EmbarkPlasma extends EmbarkJSPlasma {
  constructor(embark) {
    // plugin opts
    const config = {
      rootChainAccount: embark.pluginConfig.ROOTCHAIN_ACCOUNT,
      plasmaContractAddress: embark.pluginConfig.PLASMA_CONTRACT_ADDRESS || "0x740ecec4c0ee99c285945de8b44e9f5bfb71eea7",
      watcherUrl: normalizeUrl(embark.pluginConfig.WATCHER_URL || "https://watcher.samrong.omg.network/"),
      childChainUrl: normalizeUrl(embark.pluginConfig.CHILDCHAIN_URL || "https://samrong.omg.network/"),
      childChainExplorerUrl: normalizeUrl(embark.pluginConfig.CHILDCHAIN_EXPLORER_URL || "https://quest.samrong.omg.network"),
      dappConnection: embark.config.contractsConfig.dappConnection
    };
    super({pluginConfig: config, logger: embark.logger});

    this.config = config;
    this.embark = embark;
    this.events = embark.events;


    embark.registerActionForEvent("pipeline:generateAll:before", this.addArtifactFile.bind(this));

    this.setupEmbarkJS();
    this.registerServiceCheck();
    this.registerConsoleCommands();
    this.init();
  }

  get web3Instance() {
    return (async () => {
      if (!this._web3) {
        const provider = await this.events.request2("blockchain:client:provider", "ethereum");
        this._web3 = new Web3(provider);
      }
      return this._web3;
    })();
  }

  async init() {
    const web3 = await this.web3Instance;
    super.init(web3);
  }

  async setupEmbarkJS() {
    await this.events.request2("embarkjs:plugin:register:custom", STACK_NAME, MODULE_NAME, PACKAGE_NAME);
    await this.events.request2("embarkjs:console:regsiter:custom", STACK_NAME, MODULE_NAME, PACKAGE_NAME, this.config);
  }

  addArtifactFile(_params, cb) {
    this.events.request("pipeline:register", {
      path: [this.embark.config.embarkConfig.generationDir, 'config'],
      file: 'Plasma.json',
      format: 'json',
      content: this.config
    }, cb);
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
          return cb({name: "Loading...", status: SERVICE_CHECK_OFF});
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
