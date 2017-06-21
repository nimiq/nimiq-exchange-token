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
    const initialFundBalance = 999958000020000000000; // there is already some gas deducted for the contract
    const standardBid = 10000000000000000000;

    // enum
    const isSale = 0;
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
            assert.ok(convertInt(state) === isSale, 'should not be finalized');
        })
    });

    it('no finalization before the beginning', function() {
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
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to finalize');
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
            if (e.name === 'Error') {
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
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('trading did not fail');
            }
        });
    });

    it('take a snapshot of the blockchain', function() {
        return snapshot();
    });


    it('ethFundDeposit should have the initialFundBalance', function() {
        return NEToken.deployed()
            .then(() => {
                return web3.eth.getBalance(ethFundDeposit);
            }).then(balance => {
                assert.equal(balance, initialFundBalance, 'ethFundDeposit wrong initial balance');
            }).catch(() => {
                assert.fail('could not get balance of ethFundDeposit');
            });
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
                from: accounts[1],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.balanceOf.call(accounts[1]);
        }).then(balance => {
            assert.equal(balance, weis * tokenFirstExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should not issue tokens that overshoot the eth received cap', function() {
        let net = null;
        const weis = ethReceivedCap; // definitely too much
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.createTokens({
                from: accounts[0],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not allow token creation overshooting cap');
        }).catch(() => {
            assert.ok(true);
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
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to finalize');
            }
        });
    });

    it('should not allow ether retrieval before minimum is raised', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not allow ether retrieval before minimum is raised');
        }).catch(() => {
            assert.ok(true);
        });
    });

    it('should issue tokens correctly', function() {
        let net = null;
        const weis = ethReceivedMin;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.createTokens({
                from: accounts[2],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.balanceOf.call(accounts[2]);
        }).then(balance => {
            assert.equal(balance, weis * tokenFirstExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('no refunding at this point', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.refund({
                from: accounts[2],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to refund');
        }).catch(e => {
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to refund');
            }
        });
    });

    it('ethFundDeposit should have the initialFundBalance minus used gas', function() {
        const gasUsed = 2099999;
        const gasPrice = 20000000000;

        return NEToken.deployed()
            .then(() => {
                return web3.eth.getBalance(ethFundDeposit);
            }).then(balance => {
                assert.ok(balance >= initialFundBalance - (gasUsed * gasPrice), 'ethFundDeposit wrong initial balance');
            }).catch(() => {
                assert.fail('could not get balance of ethFundDeposit');
            });
    });

    it('should allow ether retrieval after minimum is raised', function() {
        let net = null;
        const gasUsed = 2129883; // calculated by running the transaction once
        const gasPrice = 20000000000;
        const ethValue = ethReceivedMin;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth(ethValue, {
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return web3.eth.getBalance(ethFundDeposit);
        }).then(balance => {
            const expected = ethValue + initialFundBalance - (gasUsed * gasPrice);
            assert.ok(balance >= expected, 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('failed to retrieve eth');
        });
    });

    it('should allow ether retrieval after minimum is raised', function() {
        let net = null;
        const gasUsed = 2129883 + 29756; // calculated by running the transaction once
        const gasPrice = 20000000000;
        const ethValue = standardBid;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth(ethValue, {
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return web3.eth.getBalance(ethFundDeposit);
        }).then(balance => {
            const expected = ethValue + ethReceivedMin + initialFundBalance - (gasUsed * gasPrice);
            assert.ok(balance >= expected, 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('failed to retrieve eth');
        });
    });

    it('should issue tokens correctly', function() {
        let net = null;
        const weis = standardBid;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.createTokens({
                from: accounts[3],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.balanceOf.call(accounts[3]);
        }).then(balance => {
            assert.equal(balance, weis * tokenSecondExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should allow ether retrieval after minimum is raised', function() {
        let net = null;
        const gasUsed = 2158273 + 31122; // calculated by running the transaction once
        const gasPrice = 20000000000;
        const ethValue = standardBid;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth(ethValue, {
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return web3.eth.getBalance(ethFundDeposit);
        }).then(balance => {
            const expected = ethReceivedMin + 2 * standardBid + initialFundBalance - (gasUsed * gasPrice);
            assert.ok(balance >= expected, 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('failed to retrieve eth');
        });
    });

    it('should issue tokens correctly', function() {
        let net = null;
        const weis = ethReceivedCap - ethReceivedMin - 2 * standardBid;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.createTokens({
                from: accounts[0],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.balanceOf.call(accounts[0]);
        }).then(balance => {
            assert.equal(balance, weis * tokenSecondExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should allow ether retrieval after minimum is raised', function() {
        let net = null;
        const gasUsed = 2187410 + 31869; // calculated by running the transaction once
        const gasPrice = 20000000000;
        const ethValue = ethReceivedCap - ethReceivedMin - 2 * standardBid;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth(ethValue, {
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return web3.eth.getBalance(ethFundDeposit);
        }).then(balance => {
            const expected = ethReceivedCap + initialFundBalance - (gasUsed * gasPrice);
            assert.ok(balance >= expected, 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('failed to retrieve eth');
        });
    });

    it('should not allow retrieval if funds are insufficient', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.retrieveEth(1, {
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not be possible to retrieve eth');
        }).catch(e => {
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to retrieve eth');
            }
        });
    });

    it('no refunding at this point', function() {
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
            if (e.name === 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to refund');
            }
        });
    });

    it('should not issue tokens after reaching the eth received cap', function() {
        let net = null;
        const weis = 1;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.createTokens({
                from: accounts[2],
                value: weis,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('should not allow token creation overshooting cap');
        }).catch(() => {
            assert.ok(true);
        });
    });

    it('should not allow tokens to be traded before finalization', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('trading did not fail');
        }).catch(() => {
            assert.ok(true);
        });
    });

    it('should allow early finalization', function() {
        let net = null;
        const gasUsed = 4320053 + 31869; // calculated by running the transaction once
        const gasPrice = 20000000000;

        return NEToken.deployed().then(instance => {
            net = instance;
            return net.finalize({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isFinalized);
            return web3.eth.getBalance(ethFundDeposit);
        }).then(balance => {
            const expected = ethReceivedCap + initialFundBalance - (gasUsed * gasPrice);
            assert.ok(balance >= expected, 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('could not finalize contract');
        });
    });

    it('should allow tokens to be traded after finalization', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[1], 10, {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.ok(true);
        }).catch(() => {
            assert.fail('could not trade tokens');
        });
    });
});
