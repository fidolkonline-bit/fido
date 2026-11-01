-- AlterTable
ALTER TABLE "CommissionAccrual" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payslipId" TEXT,
ADD COLUMN     "settlementId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "code" TEXT,
    "departmentId" TEXT,
    "designationId" TEXT,
    "locationId" TEXT,
    "shiftId" TEXT,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "taxId" TEXT,
    "bankName" TEXT,
    "bankAccountCipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payPeriod" TEXT NOT NULL DEFAULT 'MONTH',
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "locationId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxCount" DECIMAL(6,2),
    "interval" TEXT NOT NULL DEFAULT 'NONE',
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "balanceAtRequest" DECIMAL(6,2),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "restDays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClockEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SELF',
    "locationId" TEXT,
    "note" TEXT,
    "correctedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "calc" TEXT NOT NULL DEFAULT 'FIXED',
    "amount" DECIMAL(14,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponentAssignment" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(14,4),
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayComponentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "payPeriod" TEXT NOT NULL,
    "baseSalary" DECIMAL(14,2) NOT NULL,
    "workingDays" DECIMAL(6,2) NOT NULL,
    "daysWorked" DECIMAL(6,2) NOT NULL,
    "paidLeaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "unpaidLeaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "absentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "basicEarned" DECIMAL(14,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "commissionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gross" DECIMAL(14,2) NOT NULL,
    "deductions" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSettlement" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payslipId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_personId_key" ON "EmployeeProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_code_key" ON "EmployeeProfile"("code");

-- CreateIndex
CREATE INDEX "SalaryHistory_employeeId_effectiveFrom_idx" ON "SalaryHistory"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_name_key" ON "LeaveType"("name");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_startDate_idx" ON "LeaveRequest"("employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_name_key" ON "Shift"("name");

-- CreateIndex
CREATE INDEX "ClockEvent_employeeId_at_idx" ON "ClockEvent"("employeeId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_name_key" ON "PayComponent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_number_key" ON "PayrollRun"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_employeeId_periodStart_revision_key" ON "Payslip"("employeeId", "periodStart", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSettlement_payslipId_key" ON "CommissionSettlement"("payslipId");

-- AddForeignKey
ALTER TABLE "CommissionAccrual" ADD CONSTRAINT "CommissionAccrual_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CommissionSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryHistory" ADD CONSTRAINT "SalaryHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockEvent" ADD CONSTRAINT "ClockEvent_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponentAssignment" ADD CONSTRAINT "PayComponentAssignment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayComponentAssignment" ADD CONSTRAINT "PayComponentAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CommissionSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Department','Designation','EmployeeProfile','SalaryHistory','Holiday','LeaveType','LeaveRequest','Shift','ClockEvent','PayComponent','PayComponentAssignment','PayrollRun','Payslip','CommissionSettlement'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['hr.view','hr.manage','hr.payroll','hr.bank','leave.approve','attendance.manage','commissions.manage']))
WHERE name IN ('Owner/Admin', 'HR/Payroll');
UPDATE "Role" SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['hr.view','leave.approve','attendance.manage']))
WHERE name = 'Manager';
