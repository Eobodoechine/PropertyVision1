import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { addressSearchSchema, type AddressSearch, type PropertyAnalysisResult } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface PropertySearchFormProps {
  onAnalysisStart: () => void;
  onAnalysisComplete: (data: PropertyAnalysisResult) => void;
  onAnalysisError: (error: string) => void;
  onAnalysisEnd: () => void;
  isLoading: boolean;
}

export default function PropertySearchForm({
  onAnalysisStart,
  onAnalysisComplete,
  onAnalysisError,
  onAnalysisEnd,
  isLoading
}: PropertySearchFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    clearErrors
  } = useForm<AddressSearch>({
    resolver: zodResolver(addressSearchSchema),
    defaultValues: {
      address: ""
    }
  });

  const analyzeMutation = useMutation({
    mutationFn: async (data: AddressSearch) => {
      const response = await apiRequest("POST", "/api/property/analyze", data);
      return await response.json() as PropertyAnalysisResult;
    },
    onMutate: () => {
      onAnalysisStart();
    },
    onSuccess: (data) => {
      onAnalysisComplete(data);
      onAnalysisEnd();
    },
    onError: (error: Error) => {
      onAnalysisError(error.message);
      onAnalysisEnd();
    }
  });

  const onSubmit = (data: AddressSearch) => {
    clearErrors();
    analyzeMutation.mutate(data);
  };

  return (
    <div className="max-w-2xl mx-auto mb-8">
      <Card className="shadow-lg border border-gray-200">
        <CardContent className="p-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2" data-testid="form-title">
            Property Analysis
          </h2>
          <p className="text-gray-600 mb-6" data-testid="form-description">
            Enter a property address to get ARV estimates and comparable properties
          </p>
          
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" data-testid="property-form">
            <div>
              <Label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
                Property Address
              </Label>
              <Input
                id="address"
                type="text"
                placeholder="e.g., 123 Main St, Los Angeles, CA 90210"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                {...register("address")}
                data-testid="input-address"
              />
              {errors.address && (
                <p className="mt-1 text-sm text-red-600" data-testid="error-address">
                  {errors.address.message}
                </p>
              )}
            </div>
            
            <Button
              type="submit"
              className="w-full bg-blue-600 text-white font-medium py-3 px-6 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
              disabled={isLoading || analyzeMutation.isPending}
              data-testid="button-analyze"
            >
              {(isLoading || analyzeMutation.isPending) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Analyze Property"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
