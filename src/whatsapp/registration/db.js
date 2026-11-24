const prisma = require('../../../config/prisma');

async function executeRegistrationTx(businessName, ownerNumber, adminNumber, salesArray) {
    return await prisma.$transaction(async (tx) => {
        // 1. Daftarkan entitas Tenant baru
        const tenant = await tx.tenant.create({
            data: {
                businessName: businessName,
                waNumber: "PENDING", 
                status: "FREE_TRIAL"
            }
        });

        // 2. Siapkan array data user massal yang diikat ke Tenant ID baru
        const bulkUsers = [
            { 
                tenantId: tenant.id, 
                name: `Owner - ${businessName}`, 
                phoneNumber: ownerNumber, 
                role: "OWNER" 
            },
            { 
                tenantId: tenant.id, 
                name: "Admin SPV Sales", 
                phoneNumber: adminNumber, 
                role: "SVP" 
            }
        ];

        // Looping data sales agen lapangan
        salesArray.forEach((salesNum, index) => {
            bulkUsers.push({
                tenantId: tenant.id,
                name: `Sales Agen ${index + 1}`,
                phoneNumber: salesNum,
                role: "SALES"
            });
        });

        // 3. Masukkan seluruh user secara serentak ke PostgreSQL
        await tx.user.createMany({ 
            data: bulkUsers 
        });

        return tenant;
    });
}

module.exports = { executeRegistrationTx };