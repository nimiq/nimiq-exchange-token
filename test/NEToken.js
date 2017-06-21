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
    let tokenMin = 0;
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
            return net.TOKEN_MIN.call();
        }).then(result => {
            tokenMin = convertInt(result);
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
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('should not be possible to finalize');
            }
        });
    });

    it('no redeeming period before the beginning', function() {
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

    it('can pause while in fundraising', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.pause({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isPaused, 'should be paused');
        })
    });

    it('should not issue tokens while paused', function() {
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

    it('can proceed to fundraising', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.proceed({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isFundraising, 'should be proceeded');
        })
    });

    it('should not issue tokens below the token minimum', function() {
        return NEToken.deployed().then(net => {
            return net.createTokens({
                from: accounts[0],
                value: ((tokenMin-1) / tokenFirstExchangeRate),
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

    it('should issue tokens for the correct price in phase 2', function() {
        let net = null;
        const weis = standardBid;
        return NEToken.deployed().then(instance => {
            net = instance;
            return blockNumber();
        }).then(currentBlock => {
            // mine necessary amount of blocks
            return mineBlocks(exchangeRateChangesBlock - currentBlock - 1);
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
            assert.equal(balance, weis * tokenSecondExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should issue more tokens for the correct price in phase 2', function() {
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
            assert.equal(balance, weis * tokenSecondExchangeRate, 'got wrong amount of tokens');
        }).catch(() => {
            assert.fail('token creation did fail');
        });
    });

    it('should not allow tokens to be traded during bidding in phase 2', function() {
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
                assert.fail('token creation did not fail');
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

    it('should not allow tokens to be traded until contract is finalized', function() {
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

    it('only the owner can call the finalization', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.finalize({
                from: accounts[0],
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

    it('only the owner can call pause', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.pause({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('pausing should not be allowed');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('pausing should not be allowed');
            }
        });
    });

    it('should allow finalization', function() {
        let net = null;
        const gasUsed = 34016; // calculated by running the transaction once
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
            assert.ok(balance >= (2*standardBid+ethReceivedMin+initialFundBalance-(gasUsed*gasPrice)), 'balance is not correctly updated');
        }).catch(() => {
            assert.fail('could not finalize contract');
        });
    });

    it('can pause while finalized', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.pause({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isPaused, 'should be paused');
        })
    });

    it('should not allow tokens to be traded while paused', function() {
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

    it('only the owner can call proceed', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.proceed({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('proceeding should not be allowed');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('proceeding should not be allowed');
            }
        });
    });

    it('can proceed to finalized', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.proceed({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isFinalized, 'should be proceeded');
        })
    });

    it('should allow tokens to be traded after finalization', function() {
        return NEToken.deployed().then(net => {
            return net.transfer(accounts[3], 10, {
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

    it('no finalization after it has been called before', function() {
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

    it('only the owner can start the redeeming period', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.startRedeeming({
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('redeeming should not be allowed');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('redeeming should not be allowed');
            }
        });
    });

    it('should allow to start the redeeming period', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.startRedeeming({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isRedeeming);
        }).catch(() => {
            assert.fail('could not start redeeming period');
        });
    });

    it('can pause while redeeming', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.pause({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isPaused, 'should be paused');
        })
    });

    it('should not allow redeeming while paused', function() {
        return NEToken.deployed().then(net => {
            return net.redeemTokens("0x3D7D9AF2BF88E91A9D73D10F79C278424DDC89D83D7D9AF2BF88E91A9D73D45A", {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('redeeming did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('redeeming did not fail');
            }
        });
    });

    it('can proceed to redeeming', function() {
        let net = null;
        return NEToken.deployed().then(instance => {
            net = instance;
            return net.proceed({
                from: ethFundDeposit,
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            return net.state.call();
        }).then(state => {
            assert.ok(convertInt(state) === isRedeeming, 'should be proceeded');
        })
    });


    it('should not allow to redeem tokens below the token minimum', function() {
        return NEToken.deployed().then(net => {
            return net.redeemTokens("0x3D7D9AF2BF88E91A9D73D10F79C278424DDC89D8", {
                from: accounts[3],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(() => {
            assert.fail('redeeming did not fail');
        }).catch(e => {
            if (e.name == 'Error') {
                assert.ok(true);
            } else {
                assert.fail('redeeming did not fail');
            }
        });
    });


    it('should allow redeeming and transfer the tokens to us', function() {
        let net = null;
        return NEToken.deployed().then(_net => {
            net = _net;
            return net.redeemTokens("0x3D7D9AF2BF88E91A9D73D10F79C278424DDC89D83D7D9AF2BF88E91A9D73D45A", {
                from: accounts[0],
                gas: 2099999,
                gasPrice: 20000000000
            });
        }).then(ret => {
            assert.ok(getEvent('LogRedeemNET', ret), 'should log a RedeemNET event');
            return net.balanceOf.call(accounts[0]);
        }).then(balance => {
            assert.equal(balance, 0, 'there is still some balance left after redeeming');
            return net.balanceOf.call(ethFundDeposit);
        }).then(fundBalance => {
            assert.equal(fundBalance, standardBid * tokenFirstExchangeRate, 'the tokens were not transfered to our balance');
        }).catch(() => {
            assert.fail('could not redeem');
        });
    });
});
