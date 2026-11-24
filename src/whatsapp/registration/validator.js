const prisma = require('../../../config/prisma');

function cleanNumber(phoneStr) {
    return phoneStr.replace(/[^0-9]/g, '');
}

async function isUserExist(phoneNumber) {
    const user = await prisma.user.findUnique({
        where: { phoneNumber: phoneNumber }
    });
    return !!user;
}

async function getGlobalDuplicates(numbersArray) {
    return await prisma.user.findMany({
        where: {
            phoneNumber: { in: numbersArray }
        }
    });
}

module.exports = {
    cleanNumber,
    isUserExist,
    getGlobalDuplicates
};
