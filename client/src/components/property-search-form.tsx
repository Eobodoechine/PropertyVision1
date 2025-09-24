import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
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
      const text = await response.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok || !json) {
        const msg = (json && (json.error || json.message)) || (text ? text.slice(0, 200) : `Request failed (${response.status})`);
        throw new Error(msg || 'Request failed');
      }
      return json as PropertyAnalysisResult;
    },
    retry: false,
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

  // Guard against double-submits (race between click and pending state)
  const submittingRef = useRef(false);

  const onSubmit = async (data: AddressSearch) => {
    if (submittingRef.current || analyzeMutation.isPending) return;
    submittingRef.current = true;
    try {
      clearErrors();
      await analyzeMutation.mutateAsync(data);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="max-w-2xl mx-auto mb-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit(onSubmit)(e);
        }}
        noValidate
        className="flex gap-3 items-center bg-white/80 backdrop-blur border border-gray-200 shadow-sm rounded-full p-2"
        data-testid="property-form"
      >
        <Input
          id="address"
          type="text"
          placeholder="Enter property address (street, city, state ZIP)"
          className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none px-4 py-3"
          {...register("address")}
          data-testid="input-address"
        />
        <Button
          type="submit"
          className="rounded-full bg-teal-600 hover:bg-teal-700 text-white px-6 py-2.5"
          disabled={isLoading || analyzeMutation.isPending || submittingRef.current}
          aria-disabled={isLoading || analyzeMutation.isPending || submittingRef.current}
          data-testid="button-analyze"
        >
          {(isLoading || analyzeMutation.isPending || submittingRef.current) ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            "Search"
          )}
        </Button>
      </form>
      {errors.address && (
        <p className="mt-2 text-sm text-red-600" data-testid="error-address">
          {errors.address.message}
        </p>
      )}
    </div>
  );
}
