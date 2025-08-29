import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

interface WholesaleCalculatorProps {
  arv: number;
}

export default function WholesaleCalculator({ arv: defaultArv }: WholesaleCalculatorProps) {
  const [arv, setArv] = useState<number>(defaultArv);
  const [repairCosts, setRepairCosts] = useState<number>(0);
  const [commissionRate, setCommissionRate] = useState<number>(10);
  const [desiredEarning, setDesiredEarning] = useState<number>(2000);

  // Update ARV when default value changes
  useEffect(() => {
    setArv(defaultArv);
  }, [defaultArv]);

  // Calculate fixed costs
  const closingCosts = arv * 0.07;
  const holdingCosts = arv * 0.05;
  const investorProfit = repairCosts; // Equal to repair costs as specified

  // Calculate wholesale fee based on commission structure
  // Formula: wholesale fee = desired earning / commission rate
  const wholesaleFee = commissionRate > 0 ? (desiredEarning / (commissionRate / 100)) : 0;

  // Calculate final wholesale offer
  const totalDeductions = closingCosts + holdingCosts + repairCosts + investorProfit + wholesaleFee;
  const wholesaleOffer = arv - totalDeductions;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card className="shadow-lg border border-gray-200">
      <CardContent className="p-6">
        <h3 className="text-xl font-semibold text-gray-900 mb-4" data-testid="wholesale-title">
          💰 Wholesale Offer Calculator
        </h3>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Input Section */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="arv-value" className="text-sm font-medium text-gray-700">
                After Repair Value (ARV)
              </Label>
              <Input
                id="arv-value"
                type="number"
                value={arv}
                onChange={(e) => setArv(Number(e.target.value) || 0)}
                placeholder="0"
                min="0"
                className="mt-1"
                data-testid="input-arv-value"
              />
            </div>

            <div>
              <Label htmlFor="repair-costs" className="text-sm font-medium text-gray-700">
                Estimated Repair Costs
              </Label>
              <Input
                id="repair-costs"
                type="number"
                value={repairCosts}
                onChange={(e) => setRepairCosts(Number(e.target.value) || 0)}
                placeholder="0"
                min="0"
                className="mt-1"
                data-testid="input-repair-costs"
              />
            </div>

            <div>
              <Label htmlFor="commission-rate" className="text-sm font-medium text-gray-700">
                Salesperson Commission Rate
              </Label>
              <div className="flex items-center space-x-2 mt-1">
                <Input
                  id="commission-rate"
                  type="number"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value) || 0)}
                  placeholder="10"
                  min="0"
                  max="100"
                  step="0.1"
                  className="flex-1"
                  data-testid="input-commission-rate"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>

            <div>
              <Label htmlFor="desired-earning" className="text-sm font-medium text-gray-700">
                Desired Salesperson Earning
              </Label>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-sm text-gray-500">$</span>
                <Input
                  id="desired-earning"
                  type="number"
                  value={desiredEarning}
                  onChange={(e) => setDesiredEarning(Number(e.target.value) || 0)}
                  placeholder="2000"
                  min="0"
                  className="flex-1"
                  data-testid="input-desired-earning"
                />
              </div>
            </div>
          </div>

          {/* Calculation Breakdown */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Cost Breakdown</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">ARV (After Repair Value)</span>
                <span className="font-medium" data-testid="breakdown-arv">{formatCurrency(arv)}</span>
              </div>
              
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Closing Costs (7%)</span>
                  <span className="text-red-600" data-testid="breakdown-closing">-{formatCurrency(closingCosts)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Holding Costs (5%)</span>
                  <span className="text-red-600" data-testid="breakdown-holding">-{formatCurrency(holdingCosts)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Repair Costs</span>
                  <span className="text-red-600" data-testid="breakdown-repairs">-{formatCurrency(repairCosts)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Investor Profit</span>
                  <span className="text-red-600" data-testid="breakdown-profit">-{formatCurrency(investorProfit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Wholesale Fee</span>
                  <span className="text-red-600" data-testid="breakdown-wholesale-fee">
                    -{formatCurrency(wholesaleFee)}
                    <span className="text-xs ml-1">({commissionRate}% comm.)</span>
                  </span>
                </div>
              </div>

              <div className="border-t-2 border-gray-300 pt-2 mt-3">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-900">Maximum Wholesale Offer</span>
                  <span className={`font-bold text-lg ${wholesaleOffer > 0 ? 'text-green-600' : 'text-red-600'}`} data-testid="wholesale-offer">
                    {formatCurrency(Math.max(0, wholesaleOffer))}
                  </span>
                </div>
                {wholesaleOffer <= 0 && (
                  <p className="text-red-600 text-xs mt-1">
                    ⚠️ Costs exceed ARV - deal may not be profitable
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="mt-6 grid grid-cols-4 gap-4 pt-4 border-t border-gray-200">
          <div className="text-center">
            <p className="text-sm text-gray-600">Total Costs</p>
            <p className="font-bold text-gray-900" data-testid="total-costs">
              {formatCurrency(totalDeductions)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">Profit Margin</p>
            <p className="font-bold text-gray-900" data-testid="profit-margin">
              {arv > 0 ? ((wholesaleOffer / arv) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">Wholesale Fee</p>
            <p className="font-bold text-blue-600" data-testid="wholesale-fee-total">
              {formatCurrency(wholesaleFee)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">Salesperson Earns</p>
            <p className="font-bold text-green-600" data-testid="salesperson-earning">
              {formatCurrency(desiredEarning)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}