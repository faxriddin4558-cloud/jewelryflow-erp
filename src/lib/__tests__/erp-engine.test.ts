import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  GoldEngine,
  RBAC,
  ErpTransactionalEngine,
  GOLD_PRECISION_POLICY,
  resolveEmployeeRole,
  ERP_REPORT_TYPES,
  escapeCsvCell,
  formatCsvContent,
  buildErpReportRows,
} from "@/lib/erp-engine";

describe("GoldEngine — Pure Accounting, Precision Policy & Mass Balance", () => {
  it("converts gross gold weight to fine gold (999) accurately", () => {
    expect(GoldEngine.toFineGold(111, 988)).toBe(109.67);
    expect(GoldEngine.toFineGold(100, 585)).toBe(58.5);
    expect(GoldEngine.toFineGold(100, 999)).toBe(99.9);
    expect(GoldEngine.toFineGold(0, 585)).toBe(0);
    expect(GoldEngine.toFineGold(-50, 585)).toBe(0);
    expect(GoldEngine.toFineGold(100, 1500)).toBe(0);
  });

  it("maintains cumulative fine-gold deviation <= 0.0001 g across 100 sequential transactions of 0.3333 g at 585 purity", () => {
    // True mathematical fine gold per tx: 0.3333 * 585 / 1000 = 0.1949805 g
    // True mathematical fine gold across 100 txs: 100 * 0.1949805 = 19.49805 g (19.4981 g at 4-dp)
    const txCount = 100;
    const entries = Array.from({ length: txCount }, () => ({
      grossWeight: 0.3333,
      proba: 585,
    }));

    const accumulated = GoldEngine.accumulateFineGold(entries);
    const trueTotalFineGold = (100 * 0.3333 * 585) / 1000; // 19.49805 g
    const exactDeviation = Math.abs(accumulated.exactGrams - trueTotalFineGold);
    const rounded4dpDeviation = Math.abs(accumulated.grams4dp - Number(trueTotalFineGold.toFixed(4)));

    expect(accumulated.grossGrams).toBe(33.33);
    expect(accumulated.exactGrams).toBe(19.49805);
    expect(exactDeviation).toBeLessThanOrEqual(
      GOLD_PRECISION_POLICY.SEQUENTIAL_DRIFT_TOLERANCE_GRAM
    );
    expect(rounded4dpDeviation).toBeLessThanOrEqual(
      GOLD_PRECISION_POLICY.SEQUENTIAL_DRIFT_TOLERANCE_GRAM
    );
  });

  it("calculates down-alloying (999 -> 585) with backward-compatible fields and ligature breakdown", () => {
    const res = GoldEngine.calculateAlloy(100, 999, 585, 70);
    expect(res.fineGold).toBe(99.9);
    expect(res.pureGold).toBe(99.9);
    expect(res.requiredLigature).toBe(70.77);
    expect(res.totalOutputWeight).toBe(170.77);
    expect(res.fineGoldToAdd).toBe(0);
    expect(res.sourceGoldDeducted).toBe(100);
    expect(res.fineGold999Deducted).toBe(0);
    expect(res.silverDeducted).toBeCloseTo(21.2308, 4);
    expect(res.copperDeducted).toBeCloseTo(49.5385, 4);
    expect(res.newGoldShare).toBe(70);
    expect(res.oldGoldShare).toBe(30);
  });

  it("calculates up-alloying (585 -> 750) by requiring 999 fine gold consumption instead of ligature", () => {
    const res = GoldEngine.calculateAlloy(100, 585, 750, 70);
    expect(res.requiredLigature).toBe(0);
    expect(res.ligatureNeeded).toBe(0);
    expect(res.fineGoldToAdd).toBeCloseTo(66.2651, 4);
    expect(res.sourceGoldDeducted).toBe(100);
    expect(res.fineGold999Deducted).toBeCloseTo(66.2651, 4);
    expect(res.totalWeight).toBeCloseTo(166.2651, 4);
  });

  it("calculates refining (affinaj) expected fine gold, actual fine gold, and loss", () => {
    const ref = GoldEngine.calculateRefining(400, 585, 233.5, 999);
    expect(ref.expectedFine).toBe(234);
    expect(ref.actualFine).toBe(233.27);
    expect(ref.refLoss).toBeCloseTo(0.73, 2);
    expect(ref.isValid).toBe(true);

    const invalidRef = GoldEngine.calculateRefining(100, 585, 90, 999);
    expect(invalidRef.isValid).toBe(false);
  });

  it("verifies mass balance and rejects zero or negative input gold without fabricating balances", () => {
    const balanced = GoldEngine.verifyMassBalance({
      inputGold: 1000,
      goodProduct: 850,
      sprue: 100,
      scrap: 20,
      rework: 0,
      loss: 30,
      remainingWip: 0,
    });
    expect(balanced.isBalanced).toBe(true);
    expect(balanced.discrepancy).toBe(0);

    const partialWip = GoldEngine.verifyMassBalance({
      inputGold: 150,
      goodProduct: 60,
      sprue: 0,
      scrap: 0,
      rework: 0,
      loss: 0,
      remainingWip: 90,
    });
    expect(partialWip.isBalanced).toBe(true);

    const anomaly = GoldEngine.verifyMassBalance({
      inputGold: 1000,
      goodProduct: 850,
      sprue: 100,
      scrap: 20,
      rework: 0,
      loss: 10,
      remainingWip: 0,
    });
    expect(anomaly.isBalanced).toBe(false);
    expect(anomaly.discrepancy).toBe(20);

    const zeroInput = GoldEngine.verifyMassBalance({
      inputGold: 0,
      goodProduct: 0,
      sprue: 0,
      scrap: 0,
      rework: 0,
      loss: 0,
      remainingWip: 0,
    });
    expect(zeroInput.isBalanced).toBe(false);
  });

  it("computes SAFE gold summary strictly from Gold inventory items using exact accumulation", () => {
    const summary = GoldEngine.calculateSafeGoldSummary([
      { category: "Gold", name: "999 Gold", on_hand: 100, reserved: 20, proba: 999 },
      { category: "Gold", name: "585 Gold", on_hand: 200, reserved: 50, proba: 585 },
      { category: "Scrap", name: "585 Scrap", on_hand: 500, reserved: 0, proba: 585 },
    ]);
    expect(summary.rawGoldOnHand).toBe(300);
    expect(summary.reservedGold).toBe(70);
    expect(summary.availableGold).toBe(230);
    expect(summary.fineGoldTotal).toBe(216.9);
  });

  it("prevents double-counting of order advances and debts across sales and orders", () => {
    const orders = [
      { id: "1", order_no: "Z-1001", total_price: 95000000, advance: 20000000 },
    ];
    const sales = [
      {
        id: "s1",
        product_name: "Buyurtma Avansi (Z-1001)",
        total_amount: 20000000,
        debt_amount: 75000000,
        tx_type: "kirim",
      },
      {
        id: "s2",
        product_name: "Komplekt A",
        total_amount: 10000000,
        debt_amount: 5000000,
        tx_type: "kirim",
      },
      {
        id: "s3",
        product_name: "Kassa Xarajati (Chiqim)",
        total_amount: 3000000,
        debt_amount: 0,
        tx_type: "chiqim",
      },
    ];

    const fin = GoldEngine.calculateFinancialSummary(sales, orders);
    expect(fin.kassaIn).toBe(30000000);
    expect(fin.kassaOut).toBe(3000000);
    expect(fin.kassaNet).toBe(27000000);
    expect(fin.customerDebt).toBe(80000000);
  });
});

describe("RBAC & Security Guards — Least Privilege & Role Escalation Prevention", () => {
  beforeEach(() => {
    RBAC.resetUser();
  });

  it("denies all write permissions to Worker by default", () => {
    expect(RBAC.getCurrentUser().role).toBe("Worker");
    expect(RBAC.can("edit_inventory")).toBe(false);
    expect(RBAC.can("edit_sales")).toBe(false);
    expect(RBAC.can("create_batch")).toBe(false);
    expect(RBAC.can("move_batch")).toBe(false);
    expect(RBAC.can("edit_salary_rate")).toBe(false);
  });

  it("enforces role-specific permissions for Warehouse, Accountant, Production Manager, and Director", () => {
    expect(RBAC.hasPermission("Warehouse", "edit_inventory")).toBe(true);
    expect(RBAC.hasPermission("Warehouse", "edit_sales")).toBe(false);

    expect(RBAC.hasPermission("Accountant", "edit_sales")).toBe(true);
    expect(RBAC.hasPermission("Accountant", "edit_salary_rate")).toBe(true);
    expect(RBAC.hasPermission("Accountant", "edit_inventory")).toBe(false);

    expect(RBAC.hasPermission("Production Manager", "create_batch")).toBe(true);
    expect(RBAC.hasPermission("Production Manager", "move_batch")).toBe(true);
    expect(RBAC.hasPermission("Production Manager", "edit_sales")).toBe(false);

    expect(RBAC.hasPermission("Director", "edit_inventory")).toBe(true);
    expect(RBAC.hasPermission("Director", "edit_sales")).toBe(true);
    expect(RBAC.hasPermission("Director", "create_batch")).toBe(true);
    expect(RBAC.hasPermission("Director", "move_batch")).toBe(true);
    expect(RBAC.hasPermission("Director", "edit_salary_rate")).toBe(true);
  });

  it("blocks non-admin employee self-promotion to admin/Director and immutable ledger deletion", () => {
    const engine = new ErpTransactionalEngine();
    engine.employees.push({
      id: "emp-1",
      name: "Azizbek",
      role: "worker",
      role_type: "Worker",
      rate: 15000,
      balance: 0,
    });

    expect(() =>
      engine.updateEmployeeProfile({
        targetEmployeeId: "emp-1",
        actorEmployeeId: "emp-1",
        actorRole: "Worker",
        updates: { role: "admin", role_type: "Director" },
      })
    ).toThrow(/SECURITY_VIOLATION/);

    expect(() =>
      engine.updateEmployeeProfile({
        targetEmployeeId: "emp-1",
        actorEmployeeId: "emp-2",
        actorRole: "Supervisor",
        updates: { name: "Other" },
      })
    ).toThrow(/RLS_VIOLATION/);

    expect(() => engine.deleteAuditOrLedgerRow("audit_logs", "log-1")).toThrow(/IMMUTABLE_LEDGER/);
    expect(() => engine.deleteAuditOrLedgerRow("gold_transactions", "gtx-1")).toThrow(
      /IMMUTABLE_LEDGER/
    );
    expect(resolveEmployeeRole({ role: "admin" })).toBe("Director");
    expect(resolveEmployeeRole({ role: "worker" })).toBe("Worker");
    expect(resolveEmployeeRole({ role: "department_operator", role_type: "Supervisor" })).toBe(
      "Supervisor"
    );
    expect(resolveEmployeeRole({ role: "Zargar", role_type: "Director" })).toBe("Director");
    expect(resolveEmployeeRole({ role: "Zargar", role_type: "Operator", position: "Zargar" })).toBe(
      "Worker"
    );
  });

  it("notifies RBAC subscribers when async auth session sync updates or resets user role", () => {
    const observedRoles: string[] = [];
    const unsubscribe = RBAC.subscribe((user) => {
      observedRoles.push(`${user.role}:${user.id ?? "none"}`);
    });

    RBAC.setCurrentUser({
      id: "2",
      email: "admin@goldia.uz",
      name: "Bosh Direktor",
      role: "Director",
      department: "Boshqaruv",
    });
    expect(RBAC.getCurrentUser().role).toBe("Director");
    expect(RBAC.can("edit_inventory")).toBe(true);
    expect(RBAC.can("edit_sales")).toBe(true);

    RBAC.resetUser();
    unsubscribe();

    expect(observedRoles).toEqual(["Director:2", "Worker:none"]);
  });
});

describe("ErpTransactionalEngine — Atomic Operations, Concurrency & Idempotency", () => {
  let engine: ErpTransactionalEngine;

  beforeEach(() => {
    RBAC.setCurrentUser({ name: "Director User", role: "Director", department: "Boshqaruv" });
    engine = new ErpTransactionalEngine();
    engine.inventory = [
      { id: "gold-999", name: "Toza oltin 999", category: "Gold", proba: 999, on_hand: 200, reserved: 0, unit: "gr" },
      { id: "gold-585", name: "Oltin 585", category: "Gold", proba: 585, on_hand: 300, reserved: 0, unit: "gr" },
      { id: "gold-750", name: "Oltin 750", category: "Gold", proba: 750, on_hand: 50, reserved: 0, unit: "gr" },
      { id: "silver-999", name: "Kumush 999", category: "Silver", proba: 999, on_hand: 100, reserved: 0, unit: "gr" },
      { id: "copper-0", name: "Mis Ligatura", category: "Copper", proba: 0, on_hand: 100, reserved: 0, unit: "gr" },
      { id: "scrap-585", name: "Lom 585", category: "Scrap", proba: 585, on_hand: 100, reserved: 0, unit: "gr" },
    ];
    engine.employees = [
      { id: "emp-1", name: "Usta Sardor", department: "Quyish", role: "master", rate: 15000, balance: 0 },
    ];
  });

  it("consumes both source 585 gold AND 999 fine gold during up-alloying (585 -> 750), and rejects if 999 is insufficient", async () => {
    const res = await engine.executeAlloyTransaction({
      sourceItemId: "gold-585",
      targetItemId: "gold-750",
      inputWeight: 100,
      sourceProba: 585,
      targetProba: 750,
      fineGoldItemId: "gold-999",
      idempotencyKey: "alloy-up-1",
    });

    expect(res.status).toBe("OK");
    // 100g of 585 deducted -> 200g remaining
    expect(res.sourceOnHand).toBe(200);
    // 66.2651g of 999 fine gold deducted -> 133.7349g remaining
    expect(res.fineGold999OnHand).toBeCloseTo(133.7349, 4);
    // 166.2651g of 750 gold added -> 50 + 166.2651 = 216.2651g
    expect(res.targetOnHand).toBeCloseTo(216.2651, 4);

    // Retry with same idempotency key does not deduct again
    const retry = await engine.executeAlloyTransaction({
      sourceItemId: "gold-585",
      targetItemId: "gold-750",
      inputWeight: 100,
      sourceProba: 585,
      targetProba: 750,
      fineGoldItemId: "gold-999",
      idempotencyKey: "alloy-up-1",
    });
    expect(retry.deduplicated).toBe(true);
    expect(engine.inventory.find((x) => x.id === "gold-999")?.on_hand).toBeCloseTo(133.7349, 4);

    // Attempting up-alloying requiring more 999 fine gold than available fails atomically
    // (180g of 585 -> 875 requires (180 * 290) / (999 - 875) = 420.97g of 999 fine gold > 133.7349g available)
    await expect(
      engine.executeAlloyTransaction({
        sourceItemId: "gold-585",
        targetItemId: "gold-750",
        inputWeight: 180,
        sourceProba: 585,
        targetProba: 875,
        fineGoldItemId: "gold-999",
      })
    ).rejects.toThrow(/INSUFFICIENT_999_GOLD/);
  });

  it("serializes concurrent batch creation requests and prevents negative gold inventory", async () => {
    // gold-585 has 300g on hand. Two concurrent requests each try to issue 200g.
    const [r1, r2] = await Promise.allSettled([
      engine.createBatchWithGoldIssue({
        sourceItemId: "gold-585",
        batchNo: "B-CONC-1",
        productName: "Komplekt A",
        masterName: "Usta Sardor",
        proba: 585,
        plannedQty: 10,
        issuedGoldGram: 200,
      }),
      engine.createBatchWithGoldIssue({
        sourceItemId: "gold-585",
        batchNo: "B-CONC-2",
        productName: "Komplekt B",
        masterName: "Usta Sardor",
        proba: 585,
        plannedQty: 10,
        issuedGoldGram: 200,
      }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(engine.inventory.find((x) => x.id === "gold-585")?.on_hand).toBe(100);
  });

  it("allows an order's batch to consume its own reserved gold without double-consuming unreserved inventory, and releases unused reservations on cancellation", async () => {
    engine.orders.push({
      id: "ord-1",
      order_no: "Z-1001",
      client_name: "Mijoz A",
      proba: 585,
      qty: 10,
      weight_gram: 150,
      total_price: 90000000,
      advance: 20000000,
      status: "Kutilmoqda",
    });

    // Reserve 150g of gold-585 (on_hand: 300, reserved: 150, unreserved available: 150)
    await engine.inventoryTransaction({
      itemId: "gold-585",
      txType: "reserve",
      weight: 150,
      proba: 585,
      orderId: "ord-1",
      orderNo: "Z-1001",
    });

    const gold585 = engine.inventory.find((x) => x.id === "gold-585")!;
    expect(gold585.on_hand).toBe(300);
    expect(gold585.reserved).toBe(150);

    // Unrelated batch trying to take 200g fails because only 150g is unreserved
    await expect(
      engine.createBatchWithGoldIssue({
        sourceItemId: "gold-585",
        batchNo: "B-UNRELATED",
        productName: "Uzuk",
        masterName: "Usta Sardor",
        proba: 585,
        plannedQty: 10,
        issuedGoldGram: 200,
      })
    ).rejects.toThrow(/INSUFFICIENT_AVAILABLE_GOLD/);

    // Batch linked to ord-1 consumes 100g of its 150g reservation
    const batchRes = await engine.createBatchWithGoldIssue({
      sourceItemId: "gold-585",
      batchNo: "B-ORD-1",
      productName: "Komplekt",
      masterName: "Usta Sardor",
      proba: 585,
      plannedQty: 10,
      issuedGoldGram: 100,
      orderId: "ord-1",
    });
    expect(batchRes.consumedFromReservation).toBe(100);
    expect(batchRes.unreservedConsumed).toBe(0);
    expect(gold585.on_hand).toBe(200);
    expect(gold585.reserved).toBe(50);

    // Cancelling ord-1 releases the remaining 50g reservation
    const relRes = await engine.releaseOrderReservations({
      orderId: "ord-1",
      newStatus: "Bekor qilindi",
    });
    expect(relRes.releasedGram).toBe(50);
    expect(gold585.reserved).toBe(0);
  });

  it("moves partial WIP atomically, splits batches conserving quantities/weights, and credits finished product stock exactly once at stage 25", async () => {
    // Create zero-stock product model with BOM first
    const prodRes = await engine.createProductWithBom({
      name: "Komplekt Shohona",
      category: "Komplekt",
      proba: 585,
      bomVersion: 1,
      bomItems: [
        { component_name: "Ring", material_category: "Gold", weight_per_set: 5, proba: 585 },
        { component_name: "Earring", material_category: "Gold", weight_per_set: 10, proba: 585 },
      ],
    });
    expect(prodRes.product.stock).toBe(0);

    const created = await engine.createBatchWithGoldIssue({
      sourceItemId: "gold-585",
      batchNo: "B-WIP-1",
      productId: prodRes.product.id,
      productName: "Komplekt Shohona",
      masterName: "Usta Sardor",
      proba: 585,
      plannedQty: 10,
      issuedGoldGram: 150,
    });
    const batchId = created.batch.id!;

    // Fractional piece quantities must be rejected (no silent floor truncation)
    await expect(
      engine.splitBatch({
        parentBatchId: batchId,
        splitQty: 2.5,
      })
    ).rejects.toThrow(/INVALID_SPLIT_QTY/);

    await expect(
      engine.movePartialWip({
        batchId,
        fromStageOrder: 8,
        toStageOrder: 25,
        moveQty: 1.5,
        moveWeight: 22.5,
      })
    ).rejects.toThrow(/FRACTIONAL_PIECE_QUANTITY_NOT_ALLOWED/);

    // Split 3 units into child batch B-WIP-1-S1 (parent keeps 7 units / 105g, child gets 3 units / 45g)
    const splitRes = await engine.splitBatch({
      parentBatchId: batchId,
      splitQty: 3,
      childBatchNo: "B-WIP-1-S1",
    });
    expect(splitRes.parentRemainingQty).toBe(7);
    expect(splitRes.parentRemainingGram).toBe(105);
    expect(splitRes.childQty).toBe(3);
    expect(splitRes.childGram).toBe(45);

    // Move 4 units (60g) of parent batch directly to final stage 25
    const move1 = await engine.movePartialWip({
      batchId,
      fromStageOrder: 8,
      toStageOrder: 25,
      moveQty: 4,
      moveWeight: 60,
      idempotencyKey: "move-stage25-1",
    });
    expect(move1.newlyCreditedStock).toBe(4);
    expect(engine.products.find((p) => p.id === prodRes.product.id)?.stock).toBe(4);

    // Duplicate retry with same idempotencyKey does NOT double-credit finished stock
    const move1Retry = await engine.movePartialWip({
      batchId,
      fromStageOrder: 8,
      toStageOrder: 25,
      moveQty: 4,
      moveWeight: 60,
      idempotencyKey: "move-stage25-1",
    });
    expect(move1Retry.deduplicated).toBe(true);
    expect(engine.products.find((p) => p.id === prodRes.product.id)?.stock).toBe(4);

    // Move remaining 3 units (40g good + 3g sprue + 2g loss = 45g) to stage 25
    const move2 = await engine.movePartialWip({
      batchId,
      fromStageOrder: 8,
      toStageOrder: 25,
      moveQty: 3,
      moveWeight: 40,
      sprueGram: 3,
      lossGram: 2,
    });
    expect(move2.completed).toBe(true);
    expect(move2.newlyCreditedStock).toBe(3);
    expect(engine.products.find((p) => p.id === prodRes.product.id)?.stock).toBe(7);
  });

  it("synchronizes stage consumption with batch totals and prevents duplicate sprue return to scrap inventory", async () => {
    await engine.createBatchWithGoldIssue({
      sourceItemId: "gold-585",
      batchNo: "B-CONS-1",
      productName: "Komplekt",
      masterName: "Usta Sardor",
      proba: 585,
      plannedQty: 10,
      issuedGoldGram: 100,
    });

    const consRes = await engine.recordStageConsumption({
      batchNo: "B-CONS-1",
      masterName: "Usta Sardor",
      department: "Quyish",
      proba: 585,
      givenWeight: 100,
      returnedWeight: 85,
      sprueGram: 12,
    });
    expect(consRes.lossGram).toBe(3);
    const batch = engine.batches.find((b) => b.batch_no === "B-CONS-1")!;
    expect(batch.sprue_gram).toBe(12);
    expect(batch.loss_gram).toBe(3);
    expect(batch.wip_gram).toBe(85);

    const ret1 = await engine.returnSprueToScrapInventory({
      consumptionId: consRes.consumption.id!,
      scrapItemId: "scrap-585",
    });
    expect(ret1.scrapOnHand).toBe(112);

    // Second attempt to return same sprue is rejected
    await expect(
      engine.returnSprueToScrapInventory({
        consumptionId: consRes.consumption.id!,
        scrapItemId: "scrap-585",
      })
    ).rejects.toThrow(/DUPLICATE_SPRUE_RETURN/);
  });

  it("processes customer debt repayments without deducting product stock again and prevents over-repayment", async () => {
    engine.products.push({
      id: "prod-sale-1",
      name: "Komplekt Lux",
      category: "Komplekt",
      weight: 15,
      proba: 585,
      stock: 5,
      quantity: 5,
    });

    // Sell 2 units for 20,000,000 UZS (12,000,000 paid, 8,000,000 debt) -> stock becomes 3
    const saleRes = await engine.recordSaleWithStockDeduction({
      productId: "prod-sale-1",
      clientName: "Xaridor Olim",
      quantity: 2,
      weight: 30,
      proba: 585,
      paymentType: "Qarzga / Bo'lib to'lash",
      paidAmount: 12000000,
      debtAmount: 8000000,
    });
    expect(saleRes.remainingStock).toBe(3);

    // Over-repayment (> 8,000,000) is rejected
    await expect(
      engine.recordDebtRepayment({
        saleId: saleRes.sale.id,
        paymentType: "Naqd pul",
        repaidAmount: 9000000,
      })
    ).rejects.toThrow(/OVER_REPAYMENT_GUARD/);

    // Partial debt repayment of 5,000,000 reduces debt to 3,000,000, increases kassaIn, and leaves stock at 3!
    const rep1 = await engine.recordDebtRepayment({
      saleId: saleRes.sale.id,
      paymentType: "Naqd pul",
      repaidAmount: 5000000,
      idempotencyKey: "repay-1",
    });
    expect(rep1.previousDebt).toBe(8000000);
    expect(rep1.remainingDebt).toBe(3000000);
    expect(engine.products.find((p) => p.id === "prod-sale-1")?.stock).toBe(3);

    const summary = GoldEngine.calculateFinancialSummary(engine.sales, engine.orders);
    expect(summary.kassaIn).toBe(17000000);
    expect(summary.customerDebt).toBe(3000000);
  });

  it("updates salary ledger and employee balance atomically and blocks duplicate EARNED entries under concurrency", async () => {
    const [s1, s2] = await Promise.allSettled([
      engine.recordSalaryTransaction({
        employeeId: "emp-1",
        batchNo: "B-0010",
        stageName: "8. Quyish (Casting)",
        txType: "EARNED",
        weightDone: 50,
        rate: 15000,
        amount: 750000,
      }),
      engine.recordSalaryTransaction({
        employeeId: "emp-1",
        batchNo: "B-0010",
        stageName: "8. Quyish (Casting)",
        txType: "EARNED",
        weightDone: 50,
        rate: 15000,
        amount: 750000,
      }),
    ]);

    const fulfilled = [s1, s2].filter((r) => r.status === "fulfilled");
    const rejected = [s1, s2].filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(engine.employees.find((e) => e.id === "emp-1")?.balance).toBe(750000);

    // Paying 400,000 UZS reduces employee balance to 350,000 UZS
    const paidRes = await engine.recordSalaryTransaction({
      employeeId: "emp-1",
      batchNo: "B-0010",
      stageName: "8. Quyish (Casting)",
      txType: "PAID",
      weightDone: 0,
      rate: 0,
      amount: 400000,
    });
    expect(paidRes.newBalance).toBe(350000);
  });

  it("excludes cancelled orders from customer debt calculation and blocks debt repayments on cancelled orders", async () => {
    engine.orders.push(
      {
        id: "ord-active",
        order_no: "Z-2001",
        client_name: "Mijoz Active",
        total_price: 50000000,
        advance: 10000000,
        status: "Kutilmoqda",
      },
      {
        id: "ord-cancelled",
        order_no: "Z-2002",
        client_name: "Mijoz Cancelled",
        total_price: 80000000,
        advance: 0,
        status: "Bekor qilindi",
      }
    );

    const summary = GoldEngine.calculateFinancialSummary([], engine.orders);
    // Only ord-active (50M - 10M = 40M) is counted as customerDebt; cancelled order (80M) is excluded
    expect(summary.customerDebt).toBe(40000000);
    expect(summary.kassaIn).toBe(10000000);

    await expect(
      engine.recordDebtRepayment({
        orderId: "ord-cancelled",
        paymentType: "Naqd pul",
        repaidAmount: 5000000,
      })
    ).rejects.toThrow(/CANCELLED_ORDER_DEBT_REPAYMENT_BLOCKED/);
  });

  it("downgrades inactive or terminated employees to least-privilege Worker and maps all 001 enum roles", () => {
    expect(
      resolveEmployeeRole({ role: "admin", employment_status: "terminated" })
    ).toBe("Worker");
    expect(
      resolveEmployeeRole({ role: "Director", is_active: false })
    ).toBe("Worker");
    expect(
      resolveEmployeeRole({ role: "production_manager", employment_status: "active" })
    ).toBe("Production Manager");
    expect(
      resolveEmployeeRole({ role: "inventory_manager", employment_status: "active" })
    ).toBe("Warehouse");
    expect(
      resolveEmployeeRole({ role: "sales", employment_status: "active" })
    ).toBe("Accountant");
    expect(
      resolveEmployeeRole({ role: "department_head", employment_status: "active" })
    ).toBe("Supervisor");
  });

  it("generates all 20 distinct ERP reports and formats RFC-4180 CSV content safely without cell splitting", () => {
    expect(ERP_REPORT_TYPES).toHaveLength(20);
    expect(escapeCsvCell('Uzuk: 5g, Sirg\'a: 8g')).toBe('"Uzuk: 5g, Sirg\'a: 8g"');
    expect(escapeCsvCell('Komplekt "Shohona" #1')).toBe('"Komplekt ""Shohona"" #1"');

    const csv = formatCsvContent([
      ["Model", "BOM"],
      ["Komplekt Lux", "Uzuk: 5g, Sirg'a: 8g"],
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('Komplekt Lux,"Uzuk: 5g, Sirg\'a: 8g"');

    const ctx = {
      inv: engine.inventory,
      goldTx: [
        {
          id: "gtx-1",
          transaction_type: "ISSUE_BATCH",
          from_location: "SAFE",
          to_location: "WIP",
          material_name: "Oltin 585",
          gross_weight: 50,
          proba: 585,
          pure_gold: 29.25,
          batch_no: "B-REP-1",
          description: "Test issue",
        },
      ],
      batches: [
        {
          id: "b-rep-1",
          batch_no: "B-REP-1",
          product_name: "Uzuk",
          proba: 585,
          planned_qty: 10,
          finished_qty: 5,
          issued_gold_gram: 50,
          good_output_gram: 25,
          wip_gram: 20,
          loss_gram: 1,
          sprue_gram: 4,
          status: "Jarayonda",
        },
      ],
      wipRows: [
        {
          id: "wip-1",
          batch_id: "b-rep-1",
          stage_order: 8,
          stage_name: "8. Quyish (Casting)",
          qty_in_stage: 5,
          weight_in_stage: 20,
        },
      ],
      orders: [
        {
          id: "ord-rep-1",
          order_no: "Z-REP-1",
          client_name: "Mijoz 1",
          proba: 585,
          qty: 5,
          weight_gram: 25,
          total_price: 25000000,
          advance: 5000000,
          status: "Jarayonda",
        },
      ],
      sales: [
        {
          id: "sale-rep-1",
          client_name: "Mijoz 1",
          quantity: 2,
          weight: 10,
          proba: 585,
          total_amount: 10000000,
          paid_amount: 6000000,
          debt_amount: 4000000,
          payment_type: "Qarzga",
        },
      ],
      debtRepayments: [],
      machines: [{ id: "m-1", name: "3D Printer #1", status: "Faol", efficiency: 96, temp: "42C" }],
      consumption: [
        {
          id: "c-1",
          batch_no: "B-REP-1",
          department: "Quyish",
          master_name: "Usta Sardor",
          proba: 585,
          given_weight: 50,
          returned_weight: 45,
          sprue_gram: 4,
          loss_weight: 1,
        },
      ],
      products: [
        {
          id: "p-1",
          name: "Uzuk",
          category: "Uzuk",
          proba: 585,
          weight: 5,
          stock: 10,
          quantity: 10,
          bom_details: "Uzuk: 5g, Sirg'a: 8g",
        },
      ],
      employees: engine.employees,
      salaryLedger: engine.salaryLedger,
      qcLogs: [
        {
          id: "qc-1",
          created_at: new Date().toISOString(),
          batch_no: "B-REP-1",
          stage_name: "Quyish",
          inspector: "OTK",
          status: "Tasdiqlandi",
          defect_qty: 0,
          rework_qty: 1,
        },
      ],
    };

    const headerSignatures = new Set<string>();
    for (const repName of ERP_REPORT_TYPES) {
      const rows = buildErpReportRows(repName, ctx);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]!.length).toBeGreaterThanOrEqual(3);
      headerSignatures.add(`${repName}:${rows[0]!.join("|")}`);
    }
    expect(headerSignatures.size).toBe(20);
  });
});

describe("Database Migrations — Forward-Only Schema, Atomic RPCs & RLS Hardening Verification", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");

  it("verifies forward-only migrations 015, 016, and 017 exist and enforce all security and accounting invariants", () => {
    const m15 = fs.readFileSync(
      path.join(migrationsDir, "20260101000015_erp_operational_schema_reconciliation.sql"),
      "utf8"
    );
    const m16 = fs.readFileSync(
      path.join(migrationsDir, "20260101000016_atomic_erp_rpcs.sql"),
      "utf8"
    );
    const m17 = fs.readFileSync(
      path.join(migrationsDir, "20260101000017_security_rls_and_privilege_hardening.sql"),
      "utf8"
    );

    // Migration 015 checks
    expect(m15).toContain("chk_inventory_items_non_negative_and_reserved");
    expect(m15).toContain("idx_salary_ledger_unique_earned");
    expect(m15.toLowerCase()).toContain("create table public.inventory_reservations");
    expect(m15.toLowerCase()).toContain("create table if not exists public.debt_repayments");
    expect(m15.toLowerCase()).toContain("create table public.affinaj_records");
    expect(m15).not.toContain("extensions.uuid_generate_v4()");
    expect(m15).toContain("public.calculate_melting_loss(");
    expect(m15).toContain("p_initial_weight_grams numeric");
    expect(m15).toContain("public.handle_new_auth_user()");
    expect(m15).toContain("idx_orders_order_no_unique");
    expect(m15).toContain("idx_batches_batch_no_unique");
    expect(m15).toContain("idx_batch_stage_wip_batch_stage_unique");
    expect(m15).toContain("idx_employees_email_lower_unique");

    // Verify no ALTER TYPE ... ADD VALUE occurs inside a DO $$ block in 015
    const doBlocks015 = m15.match(/^\s*do\s+\$\$[\s\S]*?^\s*end\s+\$\$;/gim) ?? [];
    expect(doBlocks015.length).toBeGreaterThanOrEqual(4);
    for (const block of doBlocks015) {
      expect(block.toLowerCase()).not.toContain("alter type");
    }

    // Migration 016 checks (all 14 RPCs + exact fine gold helper + fail-closed permission guard + salary trigger bypass flag)
    const requiredRpcs = [
      "rpc_inventory_transaction",
      "rpc_execute_alloy_transaction",
      "rpc_execute_affinaj_transaction",
      "rpc_create_batch_with_gold_issue",
      "rpc_launch_order_production_chain",
      "rpc_move_partial_wip",
      "rpc_split_batch",
      "rpc_record_stage_consumption",
      "rpc_return_sprue_to_scrap_inventory",
      "rpc_record_sale_with_stock_deduction",
      "rpc_record_debt_repayment",
      "rpc_record_salary_transaction",
      "rpc_create_product_with_bom",
      "rpc_create_order_with_advance",
    ];
    for (const rpcName of requiredRpcs) {
      expect(m16).toContain(rpcName);
    }
    expect(m16.toLowerCase()).toContain("set search_path = public, pg_temp");
    expect(m16).toContain("set_config('app.in_salary_rpc', 'true', true)");
    expect(m16).toContain("Permission denied: authentication required");
    expect(m16.toLowerCase()).toContain(
      "revoke execute on all functions in schema public from public, anon"
    );
    expect(m16).toContain("pg_advisory_xact_lock");

    // Migration 017 checks (RLS, privilege escalation trigger, immutable ledger trigger, REVOKE anon/PUBLIC)
    expect(m17).toContain("prevent_employee_privilege_escalation");
    expect(m17).toContain("prevent_ledger_delete_or_tamper");
    expect(m17).toContain("current_employee_role_text()");
    expect(m17).toContain("employees_select_own_or_authorized");
    expect(m17).toContain("inventory_items_insert_zero_balance_card");
    expect(m17).toContain("sales_insert_expense_or_admin");
    expect(m17).toContain("enforce_audit_logs_actor");
    expect(m17.toLowerCase()).toContain('drop policy if exists "self update own profile" on public.employees');
    expect(m17.toLowerCase()).toContain(
      "revoke execute on all functions in schema public from public, anon"
    );
    expect(m17).not.toContain("grant execute on all functions in schema public to authenticated;");
  });

  it("verifies every frontend supabase.rpc(...) call across src/app matches the exact SQL parameter names in migration 016", () => {
    const m16 = fs.readFileSync(
      path.join(migrationsDir, "20260101000016_atomic_erp_rpcs.sql"),
      "utf8"
    );

    // Extract SQL RPC parameter sets from migration 016
    const rpcParamMap = new Map<string, Set<string>>();
    const fnRegex =
      /create\s+or\s+replace\s+function\s+public\.(rpc_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns/gi;
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(m16)) !== null) {
      const fnName = match[1] ?? "";
      const rawParams = match[2] ?? "";
      const paramNames = new Set<string>();
      for (const line of rawParams.split(",")) {
        const trimmed = line.trim();
        const pMatch = /^(p_[a-z0-9_]+)\s+/i.exec(trimmed);
        if (pMatch && pMatch[1]) {
          paramNames.add(pMatch[1]);
        }
      }
      rpcParamMap.set(fnName, paramNames);
    }

    const pageFiles = [
      "src/app/inventory/page.tsx",
      "src/app/calculator/page.tsx",
      "src/app/batches/page.tsx",
      "src/app/orders/page.tsx",
      "src/app/consumption/page.tsx",
      "src/app/sales/page.tsx",
      "src/app/employees/page.tsx",
      "src/app/products/page.tsx",
    ];

    let totalRpcCallsChecked = 0;
    for (const relPath of pageFiles) {
      const content = fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
      const callRegex = /supabase\.rpc\(\s*"(rpc_[a-z0-9_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g;
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(content)) !== null) {
        totalRpcCallsChecked += 1;
        const rpcName = callMatch[1] ?? "";
        const argsBlock = callMatch[2] ?? "";
        const sqlParams = rpcParamMap.get(rpcName);
        expect(sqlParams, `Missing SQL definition for ${rpcName} in 016`).toBeDefined();

        const keyRegex = /^\s*(p_[a-z0-9_]+)\s*:/gm;
        let keyMatch: RegExpExecArray | null;
        while ((keyMatch = keyRegex.exec(argsBlock)) !== null) {
          const argKey = keyMatch[1] ?? "";
          expect(
            sqlParams!.has(argKey),
            `${relPath} passes unknown parameter '${argKey}' to ${rpcName}`
          ).toBe(true);
        }
      }
    }

    expect(totalRpcCallsChecked).toBeGreaterThanOrEqual(14);
  });

  it("verifies production preflight script is 100% read-only and admin link script is transaction-safe", () => {
    const scriptsDir = path.resolve(process.cwd(), "supabase", "scripts");
    const preflight = fs.readFileSync(
      path.join(scriptsDir, "01_production_preflight_readonly.sql"),
      "utf8"
    );
    const linkScript = fs.readFileSync(
      path.join(scriptsDir, "02_manual_link_director_admin.sql"),
      "utf8"
    );

    // Preflight must contain only SELECT, NO mutating statements
    const mutatingStatements = ["insert into", "update ", "delete from", "drop table", "alter table", "create table"];
    for (const stmt of mutatingStatements) {
      expect(preflight.toLowerCase()).not.toContain(stmt);
    }
    expect(preflight.toLowerCase()).toContain("admin@goldia.uz");
    expect(preflight.toLowerCase()).toContain("chk_inventory_items");

    // Link script must have begin/commit transaction block and reference admin@goldia.uz
    expect(linkScript.toLowerCase()).toContain("begin;");
    expect(linkScript.toLowerCase()).toContain("commit;");
    expect(linkScript).toContain("admin@goldia.uz");
    expect(linkScript).toContain("Director");
    expect(linkScript).toContain("admin");
  });
});

describe("ErpTransactionalEngine — Order Creation with Advance & Idempotency Conflict Guards", () => {
  let engine: ErpTransactionalEngine;

  beforeEach(() => {
    RBAC.setCurrentUser({ name: "Director User", role: "Director", department: "Boshqaruv" });
    engine = new ErpTransactionalEngine();
  });

  it("records order and initial advance atomically without double-counting kassa or debt", async () => {
    const res = await engine.createOrderWithAdvance({
      orderNo: "Z-888001",
      clientName: "Nodirbek",
      productModel: "Shohona Komplekt",
      proba: 585,
      qty: 5,
      weightGram: 75,
      totalPrice: 60000000,
      advance: 15000000,
      idempotencyKey: "ord-adv-1",
    });

    expect(res.status).toBe("OK");
    expect(res.orderNo).toBe("Z-888001");
    expect(res.advance).toBe(15000000);
    expect(res.remainingDebt).toBe(45000000);
    expect(engine.orders).toHaveLength(1);
    expect(engine.sales).toHaveLength(1);

    const fin = GoldEngine.calculateFinancialSummary(engine.sales, engine.orders);
    expect(fin.kassaIn).toBe(15000000);
    expect(fin.kassaOut).toBe(0);
    expect(fin.customerDebt).toBe(45000000);

    // Deduplication test with exact same payload
    const retry = await engine.createOrderWithAdvance({
      orderNo: "Z-888001",
      clientName: "Nodirbek",
      productModel: "Shohona Komplekt",
      proba: 585,
      qty: 5,
      weightGram: 75,
      totalPrice: 60000000,
      advance: 15000000,
      idempotencyKey: "ord-adv-1",
    });
    expect(retry.deduplicated).toBe(true);
    expect(engine.orders).toHaveLength(1);
    expect(engine.sales).toHaveLength(1);

    // Reusing the same idempotency key with conflicting payload throws IDEMPOTENCY_KEY_CONFLICT
    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-888002",
        clientName: "Boshqa Mijoz",
        productModel: "Uzuk",
        proba: 585,
        qty: 1,
        weightGram: 10,
        totalPrice: 10000000,
        advance: 2000000,
        idempotencyKey: "ord-adv-1",
      })
    ).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT/);
  });

  it("handles zero advance gracefully without creating synthetic sale row", async () => {
    const res = await engine.createOrderWithAdvance({
      orderNo: "Z-888003",
      clientName: "Jamshid",
      productModel: "Braslet",
      proba: 585,
      qty: 2,
      weightGram: 30,
      totalPrice: 24000000,
      advance: 0,
    });

    expect(res.status).toBe("OK");
    expect(res.advanceSaleId).toBeNull();
    expect(res.remainingDebt).toBe(24000000);
    expect(engine.sales).toHaveLength(0);

    const fin = GoldEngine.calculateFinancialSummary(engine.sales, engine.orders);
    expect(fin.kassaIn).toBe(0);
    expect(fin.customerDebt).toBe(24000000);
  });

  it("rejects advance greater than total price and negative amounts", async () => {
    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-888004",
        clientName: "Test",
        productModel: "Model",
        proba: 585,
        qty: 1,
        weightGram: 10,
        totalPrice: 10000000,
        advance: 12000000,
      })
    ).rejects.toThrow(/ADVANCE_EXCEEDS_TOTAL_PRICE/);

    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-888005",
        clientName: "Test",
        productModel: "Model",
        proba: 585,
        qty: 1,
        weightGram: 10,
        totalPrice: -1000,
        advance: 0,
      })
    ).rejects.toThrow(/INVALID_ORDER_PRICE_OR_ADVANCE/);
  });

  it("verifies transaction rollback and zero partial orders on database error or duplicate order number", async () => {
    // 1. First order creation succeeds
    await engine.createOrderWithAdvance({
      orderNo: "Z-ROLLBACK-1",
      clientName: "Vali",
      productModel: "Uzuk",
      proba: 585,
      qty: 1,
      weightGram: 5,
      totalPrice: 4000000,
      advance: 1000000,
    });
    expect(engine.orders).toHaveLength(1);
    expect(engine.sales).toHaveLength(1);

    // 2. Duplicate order number fails with DUPLICATE_ORDER_NO and rolls back completely
    const prevOrdersCount = engine.orders.length;
    const prevSalesCount = engine.sales.length;

    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-ROLLBACK-1", // duplicate!
        clientName: "Boshqa Mijoz",
        productModel: "Sirg'a",
        proba: 585,
        qty: 2,
        weightGram: 10,
        totalPrice: 8000000,
        advance: 3000000,
      })
    ).rejects.toThrow(/DUPLICATE_ORDER_NO/);

    // Rollback verification: counts must remain unchanged
    expect(engine.orders).toHaveLength(prevOrdersCount);
    expect(engine.sales).toHaveLength(prevSalesCount);

    // 3. Invalid fractional quantity fails and rolls back completely
    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-ROLLBACK-2",
        clientName: "Sobir",
        productModel: "Zanjir",
        proba: 585,
        qty: 1.5, // non-integer quantity!
        weightGram: 10,
        totalPrice: 8000000,
        advance: 2000000,
      })
    ).rejects.toThrow(/INVALID_ORDER_QTY_OR_WEIGHT/);

    expect(engine.orders).toHaveLength(prevOrdersCount);
    expect(engine.sales).toHaveLength(prevSalesCount);

    // 4. Zero or negative weight fails and rolls back completely
    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-ROLLBACK-3",
        clientName: "Sobir",
        productModel: "Zanjir",
        proba: 585,
        qty: 1,
        weightGram: 0,
        totalPrice: 8000000,
        advance: 2000000,
      })
    ).rejects.toThrow(/INVALID_ORDER_QTY_OR_WEIGHT/);

    expect(engine.orders).toHaveLength(prevOrdersCount);
    expect(engine.sales).toHaveLength(prevSalesCount);

    // 5. Negative advance fails and rolls back completely
    await expect(
      engine.createOrderWithAdvance({
        orderNo: "Z-ROLLBACK-4",
        clientName: "Sobir",
        productModel: "Zanjir",
        proba: 585,
        qty: 1,
        weightGram: 5,
        totalPrice: 8000000,
        advance: -500000,
      })
    ).rejects.toThrow(/INVALID_ORDER_PRICE_OR_ADVANCE/);

    expect(engine.orders).toHaveLength(prevOrdersCount);
    expect(engine.sales).toHaveLength(prevSalesCount);
  });

  it("verifies src/app/orders/page.tsx strictly uses atomic RPC and has NO non-atomic fallback inserts", () => {
    const ordersPagePath = path.resolve(process.cwd(), "src", "app", "orders", "page.tsx");
    const content = fs.readFileSync(ordersPagePath, "utf8");

    // 1. Must call rpc_create_order_with_advance
    expect(content).toContain('supabase.rpc(\n        "rpc_create_order_with_advance"');

    // 2. Must NOT contain direct fallback inserts into orders or sales tables
    expect(content).not.toContain('supabase.from("orders").insert(');
    expect(content).not.toContain('supabase.from("sales").insert(');
    expect(content).not.toContain('.from("orders")\n        .insert(');
    expect(content).not.toContain('.from("sales")\n        .insert(');

    // 3. Must alert explaining required migration is not applied
    expect(content).toContain("016_atomic_erp_rpcs.sql migratsiyasi qo'llanmagan");
    expect(content).toContain("chala buyurtma yaratish taqiqlangan");
  });

  it("enforces deterministic role precedence and prevents director lockout from legacy worker role column", () => {
    // When role_type is 'Director' but legacy role column is default 'worker', role_type wins:
    expect(resolveEmployeeRole({ role: "worker", role_type: "Director" })).toBe("Director");
    expect(resolveEmployeeRole({ role: "viewer", role_type: "Director" })).toBe("Director");
    expect(resolveEmployeeRole({ role: "department_operator", role_type: "Director" })).toBe("Director");

    // When role column is 'admin' but role_type is generic 'Worker', role takes precedence:
    expect(resolveEmployeeRole({ role: "admin", role_type: "Worker" })).toBe("Director");

    // Specific role_type takes precedence over generic worker in role:
    expect(resolveEmployeeRole({ role: "worker", role_type: "Production Manager" })).toBe("Production Manager");
    expect(resolveEmployeeRole({ role: "worker", role_type: "Supervisor" })).toBe("Supervisor");
    expect(resolveEmployeeRole({ role: "worker", role_type: "Warehouse" })).toBe("Warehouse");
    expect(resolveEmployeeRole({ role: "worker", role_type: "Accountant" })).toBe("Accountant");

    // Inactive employee always downgrades to Worker:
    expect(resolveEmployeeRole({ role: "admin", role_type: "Director", is_active: false })).toBe("Worker");
    expect(resolveEmployeeRole({ role: "admin", role_type: "Director", status: "inactive" })).toBe("Worker");
    expect(resolveEmployeeRole({ role: "admin", role_type: "Director", employment_status: "terminated" })).toBe("Worker");

    // Unknown or malformed tokens fail closed to Worker:
    expect(resolveEmployeeRole({ role: "unknown_hack", role_type: "malformed" })).toBe("Worker");
    expect(resolveEmployeeRole(null)).toBe("Worker");
  });
});
