// Specifically request an abstraction for NEToken
var NEToken = artifacts.require("NEToken");

async function mineBlocks(num=1) {
    for (let i=0; i<num; ++i) {
        await new Promise(function(resolve, reject) { web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "evm_mine", id: i }, function(err, result) { resolve(); }); });
    }
}

function blockNumber() {
    return new Promise(function(resolve, reject) {
        web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "eth_blockNumber", id: 0x05 }, function(err, result) { resolve(parseInt(result.result)) });
    });
}

function lastBlock() {
    return new Promise(function(resolve, reject) {
        web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "eth_blockNumber", id: 0x05 }, function(err, result) { resolve(web3.eth.getBlock(parseInt(result.result))) });
    });
}

function convertInt(val) {
    return val.toNumber();
}

function snapshot() {
    return new Promise(function(resolve, reject) {
        web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "evm_snapshot", id: 0xabcd }, function(err, result) { resolve(); });
    });
}

function revert() {
    return new Promise(function(resolve, reject) {
        web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "evm_revert", id: 0xabcd }, function(err, result) { resolve(); });
    });
}

function reset() {
    return new Promise(function(resolve, reject) {
        web3.currentProvider.sendAsync({ jsonrpc: "2.0", method: "evm_reset", id: 0xabce }, function(err, result) { resolve(); });
    });
}

function getEvent(event, result) {
    for (let i = 0; i < result.logs.length; i++) {
        const log = result.logs[i];

        if (log.event === event) {
            return log;
        }
    }
    return undefined;
}

contract('NEToken', function(accounts) {

    let fundingStartBlock = 0;
    let exchangeRateChangesBlock = 0;
    let fundingEndBlock = 0;
    let tokenFirstExchangeRate = 0;
    let tokenSecondExchangeRate = 0;
    let ethReceivedCap = 0;
    let ethReceivedMin = 0;
    let tokenCreationCap = 0;
    let ethFundDeposit = '';
    const initialFundBalance = 999580000200000000000; // there is already some gas deducted for the contract
    const standardBid = 10000000000000000000;

    // enum
    const isFundraising = 0;
    const isFinalized = 1;
    const isRedeeming = 2;
    const isPaused = 3;

    before(async function() {
        await reset();
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.fundingStartBlock.call();
        }).then(result => {
            fundingStartBlock = convertInt(result);
            return net.exchangeRateChangesBlock.call();
        }).then(result => {
            exchangeRateChangesBlock = convertInt(result);
            return net.fundingEndBlock.call();
        }).then(result => {
            fundingEndBlock = convertInt(result);
            return net.TOKEN_FIRST_EXCHANGE_RATE.call();
        }).then(result => {
            tokenFirstExchangeRate = convertInt(result);
            return net.TOKEN_SECOND_EXCHANGE_RATE.call();
        }).then(result => {
            tokenSecondExchangeRate = convertInt(result);
            return net.ETH_RECEIVED_CAP.call();
        }).then(result => {
            ethReceivedCap = convertInt(result);
            return net.ETH_RECEIVED_MIN.call();
        }).then(result => {
            ethReceivedMin = convertInt(result);
            return net.TOKEN_CREATION_CAP.call();
        }).then(result => {
            tokenCreationCap = convertInt(result);
            return net.ethFundDeposit.call();
        }).then(result => {
            ethFundDeposit = result;
        });
    });

    it('should start at block 4', function() {
        return NEToken.deployed().then(instance => {
            return blockNumber();
        }).then(block => {
            assert.equal(block, 4, 'after deploying we should be at block 4, perhaps you should restart testrpc');
        });
    });

    it('should have a fundingStartBlock in the future', function() {
        return blockNumber().then(currentBlock => {
            assert.ok(currentBlock < (fundingStartBlock - 1), 'fundingStartBlock is not in the future');
        });
    });

    it('is not yet finalized/redeeming', function() {
        return NEToken.deployed().then(net => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isFundraising, 'should not be finalized');
        })
    });

    it('no refunding before the beginning', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.refund({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to refund');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to refund');
            }
        });
    });

    it('should not issue tokens before the beginning', function() {
        return NEToken.deployed().then(net => {
            return net.createTokens({
                from: accounts[0],
                value: standardBid,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('token creation did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('token creation did not fail');
            }
        });
    });

    it('should not allow tokens to be traded without having them', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('trading did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('trading did not fail');
            }
        });
    });

    it('take a snapshot of the blockchain', function() {
        return snapshot();
    });

    it('should issue tokens for the correct price in phase 1', function() {
        let net = null;
        const weis = standardBid;
        return NEToken.deployed().then(instance => {
            net = instance;
            return blockNumber();
        }).then(currentBlock => {
            // mine necessary amount of blocks
            return mineBlocks(fundingStartBlock - currentBlock - 1);
        }).then(() => {
            return net.createTokens({
                from: accounts[0],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.balanceOf.call(accounts[0]);
        }).then(balance => {
            assert.equal(balance, weis * tokenFirstExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should not allow tokens to be traded during bidding in phase 1', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('trading did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('trading did not fail');
            }
        });
    });

    it('no refunding during the campaign', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.refund({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to refund');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to refund');
            }
        });
    });

    it('no finalization before the end when the cap conditions are not met', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.finalize({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to finalize');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to finalize');
            }
        });
    });

    it('should not issue tokens after the funding has ended (because of reaching fundingEndBlock)', function() {
        let net = null;
        const weis = standardBid;
        return NEToken.deployed().then(instance => {
            net = instance;
            return blockNumber();
        }).then(currentBlock => {
            // mine necessary amount of blocks
            return mineBlocks(fundingEndBlock - currentBlock); // we need to be > than fundingEndBlock
        }).then(() => {
            return net.createTokens({
                from: accounts[2],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(balance => {
            assert.fail('token creation did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('token creation did not fail');
            }
        });
    });

    it('should not allow tokens to be traded', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('trading did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('trading did not fail');
            }
        });
    });

    it('should not allow finalization (since below the ethReceivedMin)', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.finalize({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('finalization should not be allowed');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('finalization should not be allowed');
            }
        });
    });

    it('should not allow tokens to be traded since funding goal has not been reached', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('trading did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('trading did not fail');
            }
        });
    });

    it('should allow refunding', function() {
        let net = null;
        let initialBalance = 0;
        let gasUsed = 0;
        const gasPrice = 20000000000;
        return NEToken.deployed().then(instance => {
            net = instance;
            return web3.eth.getBalance(accounts[0]);
        }).then(balance => {
            initialBalance = convertInt(balance);
            return net.refund({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(ret => {
            assert.ok(getEvent('LogRefund', ret), 'should log a Refund event');
            return lastBlock();
        }).then(lastBlock => {
            gasUsed = lastBlock.gasUsed + 1; // Add some extra gas to work around rounding errors
            return web3.eth.getBalance(accounts[0]);
        }).then(balance => {
            assert.ok(balance >= (initialBalance+standardBid-(gasUsed*gasPrice)), 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('could not refund');
        });
    });

    it('should not allow to start redeeming period', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.startRedeeming({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to start redeeming phase');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to start redeeming phase');
            }
        });
    });

    it('should not allow to redeem tokens', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.redeemTokens("0x3D7D9AF2BF88E91A9D73D10F79C278424DDC89D83D7D9AF2BF88E91A9D73D45A", {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to redeem');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to redeem');
            }
        });
    });
});
