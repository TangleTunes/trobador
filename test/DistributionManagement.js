const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("Distribution Management", function () {
    async function deployedContractFixture() {
        const Contract = await ethers.getContractFactory("TangleTunes")
        const contract = await Contract.deploy()
        await contract.deployed()
    
        const [deployer, validator, rightholder, author, dist0, dist1, dist2, dist3, addr1] = await ethers.getSigners()
        await contract.connect(validator).create_user("Validator", "")
        await contract.connect(rightholder).create_user("Rightholder", "")
        await contract.connect(author).create_user("Author", "")
        await contract.manage_validators(validator.address)
        await contract.connect(dist0).create_user("Dist0", "")
        await contract.connect(dist1).create_user("Dist1", "")
        await contract.connect(dist2).create_user("Dist2", "")
        await contract.connect(dist3).create_user("Dist3", "")


        const song = {
            author: author.address,
            name: "abcd",
            price: 123,
            length: 456,
            duration: 789,
            chunks: [`0x${"12".repeat(32)}`, `0x${"34".repeat(32)}`, `0x${"56".repeat(32)}`],
            nonce: await contract.get_author_of_length(author.address)
        }

        song.sig = await rightholder.signMessage(ethers.utils.arrayify(ethers.utils.solidityKeccak256([
            "address",
            "string",
            "uint256",
            "uint256",
            "uint256",
            "bytes32[]",
            "uint256"
        ], Object.values(song))))

        await contract.connect(validator).upload_song(...Object.values(song))

        const song_id = ethers.utils.solidityKeccak256(["string", "address"], [song.name, song.author])

        return { contract, song_id, deployer, validator, rightholder, author, dist0, dist1, dist2, dist3, addr1 }
    }

    async function check_distributor(contract, song_id, size, addresses, fees) {
        //get_distributors_length(bytes32 _song)
        expect(await contract.get_distributors_length(song_id)).to.equal(size)
        //get_distributors(bytes32 _song, address _start, uint _amount)
        const distributors = await contract.get_distributors(song_id, ethers.constants.AddressZero, size)
        for (let i = 0; i < size; i++) {
            expect(distributors[i].distributor).to.equal(addresses[i])
            expect(distributors[i].fee).to.equal(fees[i])
        }
        //get_rand_distributor(bytes32 _song, uint _seed)
        for (let i = 0; i < size; i++) {
            values = await contract.get_rand_distributor(song_id, i)
            expect(values.distributor).to.equal(addresses[i])
            expect(values.fee).to.equal(fees[i])
        }
    }

    it("Distributor should be able to distribute a song", async function () {
        const { contract, song_id, dist0, addr1 } = await loadFixture(deployedContractFixture)
        //Only users with account can distribute
        await expect(contract.connect(addr1).distribute([song_id], [0], [ethers.constants.AddressZero], [ethers.constants.AddressZero]))
            .to.be.revertedWith('User do not exist');

        //Empty list
        expect(await contract.get_distributors_length(song_id)).to.equal(0)

        //First distributor
        await contract.connect(dist0).distribute([song_id], [0], [ethers.constants.AddressZero], [ethers.constants.AddressZero])
        await check_distributor(contract, song_id, 1, [dist0.address], [0])
    });

    it("Multiple distributors should be able to distribute a song", async function () {
        const { contract, song_id, dist0, dist1, dist2, dist3 } = await loadFixture(deployedContractFixture)

        // order_of_insert => [(dist1, 1), (dist0, 0), (dist3, 3)]
        await contract.connect(dist1).distribute([song_id], [1], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [1]))
        await contract.connect(dist0).distribute([song_id], [0], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [0]))
        await contract.connect(dist3).distribute([song_id], [3], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [3]))

        //detect wrong index
        await expect(contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], [ethers.constants.AddressZero]))
            .to.be.revertedWith('Incorrect insert index');
        await expect(contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], [dist3.address]))
            .to.be.revertedWith('Incorrect insert index');
        await expect(contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], [dist2.address]))
            .to.be.revertedWith('Insert Index is not distributing');

        //last distributor in the middle
        await contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [2]))

        const expected_addresses = [dist0.address, dist1.address, dist2.address, dist3.address]
        await check_distributor(contract, song_id, 4, expected_addresses, [0, 1, 2, 3])
    });

    it("Distributor should be able to decrease fee", async function () {
        const { contract, song_id, author, dist0, dist1, dist2, dist3 } = await loadFixture(deployedContractFixture)

        // order_of_insert => [(dist1, 1), (dist0, 0), (dist3, 3), (dist2, 2)]
        await contract.connect(dist1).distribute([song_id], [1], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [1]))
        await contract.connect(dist0).distribute([song_id], [0], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [0]))
        await contract.connect(dist3).distribute([song_id], [3], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [3]))
        await contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [2]))

        //detect wrong index
        await expect(contract.connect(dist3).distribute([song_id], [0], [dist1.address], await contract.find_insert_indexes([song_id], [0])))
            .to.be.revertedWith('Incorrect distributor distributor');
        await expect(contract.connect(dist3).distribute([song_id], [0], [author.address], await contract.find_insert_indexes([song_id], [0])))
            .to.be.revertedWith('Distributor index is not distributing');
        await expect(contract.connect(dist3).distribute([song_id], [0], await contract.find_dist_indexes([song_id], [dist3.address]), [dist1.address]))
            .to.be.revertedWith('Incorrect insert index');
        await expect(contract.connect(dist3).distribute([song_id], [0], await contract.find_dist_indexes([song_id], [dist3.address]), [author.address]))
            .to.be.revertedWith('Insert Index is not distributing');

        //last distributor in the middle
        await contract.connect(dist3).distribute([song_id], [0], await contract.find_dist_indexes([song_id], [dist3.address]), await contract.find_insert_indexes([song_id], [0]))

        const expected_addresses = [dist3.address, dist0.address, dist1.address, dist2.address]
        await check_distributor(contract, song_id, 4, expected_addresses, [0, 0, 1, 2])
    });

    it("Distributor should be able to increase fee", async function () {
        const { contract, song_id, dist0, dist1, dist2, dist3 } = await loadFixture(deployedContractFixture)

        // order_of_insert => [(dist1, 1), (dist0, 0), (dist3, 3), (dist2, 2)]
        await contract.connect(dist1).distribute([song_id], [1], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [1]))
        await contract.connect(dist0).distribute([song_id], [0], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [0]))
        await contract.connect(dist3).distribute([song_id], [3], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [3]))
        await contract.connect(dist2).distribute([song_id], [2], [ethers.constants.AddressZero], await contract.find_insert_indexes([song_id], [2]))

        //detect wrong index
        await expect(contract.connect(dist0).distribute([song_id], [3], [dist2.address], await contract.find_insert_indexes([song_id], [3])))
            .to.be.revertedWith('Incorrect distributor distributor');
        await expect(contract.connect(dist0).distribute([song_id], [3], await contract.find_dist_indexes([song_id], [dist0.address]), [dist3.address]))
            .to.be.revertedWith('Incorrect insert index');

        //last distributor in the middle
        await contract.connect(dist0).distribute([song_id], [3], await contract.find_dist_indexes([song_id], [dist0.address]), await contract.find_insert_indexes([song_id], [3]))

        const expected_addresses = [dist1.address, dist2.address, dist0.address, dist3.address]
        await check_distributor(contract, song_id, 4, expected_addresses, [1, 2, 3, 3])
    });

    it("Distributor should be able to undistribute song", async function () {
        //TODO
        expect(false).to.equal(true)
    });

    it("Remove all distributions when song is directly deleted", async function () {
        //TODO
        expect(false).to.equal(true)
    });

    it("Remove all distributions when song is indirectly deleted", async function () {
        //TODO
        expect(false).to.equal(true)
    });
});