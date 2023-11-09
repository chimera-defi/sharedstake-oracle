const https = require('https');
const fs = require('fs');

// This is a simplified oracle written in JS using external APIs
// It relies on a local file containing validator indices 
// Retrieved using ` ./prysm.sh validator accounts list --list-validator-indices` on the eth2 server based on https://github.com/prysmaticlabs/prysm/pull/8520
// And the beacon chain api
// Potentially usable for a dashboard on the site as well with minor modifications

// Idea is to use this to calculate and verify the virtual price for eth rewards when the merge happens
// Howto: 'node oracleScript.js'

let results = [];
let filePath = './all_validator_indices.txt'
let reqUrl = 'https://beaconcha.in/api/v1/validator/';
let rpc = {
    hostname: 'rpc.sharedtools.org',
    path: '/rpc',
}
const ELR_ADDR = '0xa1feaF41d843d53d0F6bEd86a8cF592cE21C409e';

function getCurrentDate() {
    // https://stackoverflow.com/questions/10211145/getting-current-date-and-time-in-javascript
    var currentdate = new Date();
    var datetime = "Sync date time: " + currentdate.getDate() + "/"
                + (currentdate.getMonth()+1)  + "/" 
                + currentdate.getFullYear() + " @ "  
                + currentdate.getHours() + ":"  
                + currentdate.getMinutes() + ":" 
                + currentdate.getSeconds();
    return datetime;
}

function chunkArray(array, size) {
    if (array.length <= size) {
        return [array]
    }
    return [array.slice(0, size), ...chunkArray(array.slice(size), size)]
}

async function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let body = "";
            res.on("data", chunk => body += chunk)
            res.on("end", () => {
                try {
                    resolve(body)
                } catch (error) {
                    reject(error.message);
                };
            });
        });
    });
}

function getValidatorIndicesFromFile(filePath) {
    indexFile = fs.readFileSync(filePath, 'utf8')
    let indices = [];

    // Transform from a newline seperated text of 'pubkey: index' pairs like so: "0x89b9d095: 115157" to an array of indices
    indexFile.split('\n').forEach(str => {
        try {
            indices.push(str.match(/:(.*)/g).pop().replace(':', '').trim())
        } // give it your best shot bud
        catch (error) { }
    });

    // remove first empty row which is a header
    indices.shift();

    //sort to match exit change script
    indices = indices.sort((a,b) => a -b)

    return indices;
}

async function getAllValidatorInfo(indices) {
    // beacon chain api supports 100 indices per call, and a max of 10 calls/min for free tier
    await Promise.all(chunkArray(indices, 100).map(async (chunk) => {
        let url = reqUrl.concat(chunk.toString());
        let res = await httpGet(url);
        try {
            results = results.concat(JSON.parse(res).data);
        } catch (e) {
            console.log(e);
            console.log(`Failed to parse ${res}`)
        }
    }))
}

async function getELRewards() {
    // curl -X POST https://rpc.sharedtools.org/rpc \
    // -H "Content-Type: application/json" \
    // --data \
    // '
    // {
    //   "jsonrpc": "2.0",
    //   "method": "eth_getBalance",
    //   "params": ["0xa1feaF41d843d53d0F6bEd86a8cF592cE21C409e", "latest"],
    //   "id": 1
    // }
    let myHeaders = ["Content-Type", "application/json"];
    let raw = JSON.stringify({
        "method": "eth_getBalance",
        "params": [
            ELR_ADDR,
            "latest"
        ],
        "id": 1,
        "jsonrpc": "2.0"
    });
    let requestOptions = {
        ...rpc,
        method: 'POST',
        port: 443,
    };
    return new Promise((resolve, reject) => {
        let req = https.request(requestOptions, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk)
            res.on("end", () => {
                try {
                    resolve(parseInt(JSON.parse(body).result))
                } catch (error) {
                    reject(error.message);
                };
            });

            res.on("error", function (error) {
                console.error(error);
            });
        });

        req.setHeader(...myHeaders);
        req.write(raw);
        req.end();
    });
}

async function fetchData() {
    let indices = getValidatorIndicesFromFile(filePath);
    await getAllValidatorInfo(indices);
    // console.log(`Debug: filepath: ${filePath} | index count: ${indices.length} | first index: ${indices[0]} | results: ${results.length}`)
    // console.log(`val 1: ` + JSON.stringify(results[0]))

    let totalBal = 0;
    let effectiveBal = 0;
    let totalWithdrawals = 0;
    let nameErr = 0;
    let validatorErr = 0, exited = 0;
    let changedWithdrawalcredentials = 0;
    results.forEach(validator => {
        if (validator.name !== "@ChimeraDefi") nameErr++;
        if (validator.status !== "active_online" || validator.slashed !== false) {
            if (validator.status == 'exited') {
                exited++;
                // console.log('Exited ', validator.validatorindex)
            } else {
                validatorErr++;
                console.log(`Validator ERR: ${JSON.stringify(validator)}`)
            }
        }
        vwc = validator.withdrawalcredentials.split('')
        if (vwc[3] !== '0') {
            changedWithdrawalcredentials++;
            // if (validator.status !== 'exited') console.log(`cred changed:  ${JSON.stringify(validator.validatorindex)}`)
            // console.log(`Withdrawal creds Changed: ${JSON.stringify(validator.validatorindex)} to ${vwc.join('')}`)
        }

        totalWithdrawals += validator.total_withdrawals
        totalBal += validator.balance;
        effectiveBal += validator.effectivebalance;
    })
    // ugly manual patch - manually add eth from mev 
    //- apr 30 - 180 Eth minus 20%
    // may 24 - 200 eth
    // let ELR = 215 * 1e9; // execution layer rewards
    let ELR = await getELRewards();
    ELR = ELR / 1e9; // ELR is 1e18 but we use 1e9
    let CLR = totalBal;
    totalBal += ELR;
    totalGains = totalBal - effectiveBal;
    let virtualPrice = totalBal / effectiveBal;

    // Account for 20% take
    let totalFees = totalGains * 0.2;
    let totalGainsPostFees = totalGains - totalFees;
    let virtualPricePostFees = (effectiveBal + totalGainsPostFees) / effectiveBal;

    return {
        totalValidators: results.length,
        totalBal,
        totalWithdrawals,
        changedWithdrawalcredentials,
        nameErr,
        validatorErr,
        ELR,
        CLR,
        effectiveBal,
        virtualPrice,
        virtualPricePostFees,
        exited
    }
}

async function printData(getternFn) {
    let {
        totalValidators,
        totalBal,
        totalWithdrawals,
        changedWithdrawalcredentials,
        nameErr,
        validatorErr,
        ELR,
        CLR,
        effectiveBal,
        virtualPrice,
        virtualPricePostFees,
        exited
    } = await getternFn();

    console.log(getCurrentDate());

    console.log(`Total Validators: ${totalValidators} \n \
                Total Eth: ${totalBal / 1e9} \n \
                Total withdrawals: ${totalWithdrawals} \n \
                Total Exited: ${exited} \n \
                Creds Changed: ${changedWithdrawalcredentials} \n \
                Total name changed Validators: ${nameErr} \n \
                Total failed Validators: ${validatorErr} \n \
                Total Consensus layer rewards: ${CLR} \n \
                Total Execution layer rewards: ${ELR} \n \
                Total Gains: ${(totalBal - effectiveBal) / 1e9} \n \
                Virtual price: ${virtualPrice} \n \
                Virtual Price post fees: ${virtualPricePostFees} \n \
                Virtual Price for Oracle: ${virtualPricePostFees * 1e18}`);
}

printData(fetchData);
