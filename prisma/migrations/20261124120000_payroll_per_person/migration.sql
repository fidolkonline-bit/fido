-- One-person payroll runs: null = everyone.
ALTER TABLE "PayrollRun" ADD COLUMN "employeeId" TEXT;

ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
