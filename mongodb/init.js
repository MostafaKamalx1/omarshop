const database = db.getSiblingDB("MobileShopDB");

const existingCollections = new Set(database.getCollectionNames());
function createCollection(name, options) {
  if (!existingCollections.has(name)) {
    database.createCollection(name, options);
    existingCollections.add(name);
  }
}

createCollection("products", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "name",
        "type",
        "quantity",
        "purchasePrice",
        "sellingPrice",
        "minQuantity",
        "createdAt"
      ],
      properties: {
        name: { bsonType: "string", minLength: 1 },
        type: { bsonType: "string", minLength: 1 },
        quantity: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        purchasePrice: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        sellingPrice: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        minQuantity: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        createdAt: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

createCollection("customers", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "phone", "address", "balance"],
      properties: {
        name: { bsonType: "string", minLength: 1 },
        phone: { bsonType: "string", minLength: 1 },
        address: { bsonType: "string" },
        balance: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

createCollection("invoices", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["customerId", "items", "subtotal", "paid", "remaining", "status", "createdAt"],
      properties: {
        customerId: { bsonType: "objectId" },
        items: {
          bsonType: "array",
          minItems: 1,
          items: {
            bsonType: "object",
            required: ["productId", "name", "quantity", "unitPrice", "total"],
            properties: {
              productId: { bsonType: "objectId" },
              name: { bsonType: "string", minLength: 1 },
              quantity: { bsonType: ["int", "long", "double", "decimal"], minimum: 1 },
              unitPrice: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
              total: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 }
            }
          }
        },
        subtotal: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        paid: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        remaining: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        status: { enum: ["unpaid", "partial", "paid"] },
        createdAt: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

createCollection("payments", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["customerId", "amount", "paymentMethod", "createdAt"],
      properties: {
        customerId: { bsonType: "objectId" },
        invoiceId: { bsonType: "objectId" },
        amount: { bsonType: ["int", "long", "double", "decimal"], exclusiveMinimum: 0 },
        paymentMethod: { enum: ["cash", "card", "transfer", "instapay", "other"] },
        createdAt: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

database.products.createIndex({ name: 1 });
database.products.createIndex({ type: 1 });
database.customers.createIndex({ phone: 1 }, { unique: true });
database.invoices.createIndex({ customerId: 1, createdAt: -1 });
database.invoices.createIndex({ status: 1 });
database.payments.createIndex({ customerId: 1, createdAt: -1 });
database.payments.createIndex({ invoiceId: 1 });

print(`Database ${database.getName()} created successfully.`);