# sharedstake-oracle
Simple oracle for sharedstake v1 &amp; v2

This is a simplified oracle written in JS using external APIs  

It relies on a local file containing validator indices     
Retrieved using ` ./prysm.sh validator accounts list --list-validator-indices` on the eth2 server based on https://github.com/prysmaticlabs/prysm/pull/8520
And the beacon chain api    
Potentially usable for a dashboard on the site as well with minor modifications    
 
Idea is to use this to calculate and verify the virtual price for eth rewards when the merge happens     
You can run it locally and check the data using: `node oracleScript.js`  
