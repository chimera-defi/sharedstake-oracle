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

function chunkArray(array, size) {
    if(array.length <= size){
        return [array]
    }
    return [array.slice(0,size), ...chunkArray(array.slice(size), size)]
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
    indexFile.split('\n').forEach(str => indices.push(str.match(/:(.*)/g).pop().replace(':','').trim()));
    // remove first empty row which is a header
    indices.shift();
    return indices;
}

async function getAllValidatorInfo(indices) {
    // beacon chain api supports 100 indices per call, and a max of 10 calls/min for free tier
    await Promise.all(chunkArray(indices, 100).map(async (chunk) => {
        let url = reqUrl.concat(chunk.toString());
        let res = await httpGet(url);
        results = results.concat(JSON.parse(res).data);
    }))
}

async function fetchData() {
    let indices = getValidatorIndicesFromFile(filePath);
    await getAllValidatorInfo(indices);
    console.log(`Debug: filepath: ${filePath} | index count: ${indices.length} | first index: ${indices[0]} | results: ${results.length}`)

    let totalBal = 0;
    let effectiveBal = 0;
    results.forEach(validator => {
        totalBal += validator.balance;
        effectiveBal += validator.effectivebalance;
    })
    let virtualPrice = totalBal/effectiveBal;
    
    console.log(`Total Validators: ${results.length} \n \
                Total Eth: ${totalBal/1e8} \n \
                Total Gains: ${(totalBal-effectiveBal)/1e8} \n \
                Virtual Price: ${virtualPrice}
                Virtual Price for Oracle: ${virtualPrice*1e18}`);
}

fetchData();
