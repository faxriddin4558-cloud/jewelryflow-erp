"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    // Supabase orqali tekshirish
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      setError("Email yoki parol noto'g'ri!");
      setLoading(false);
    } else {
      // Muvaffaqiyatli kirilsa, dashboard (boshqaruv paneli) ga o'tkazish
      router.push("/dashboard");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">JewelryFlow ERP</h1>
          <p className="mt-2 text-sm text-gray-600">Tizimga kirish uchun ma'lumotlaringizni kiriting</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-5">
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@zavod.uz"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" 
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Parol</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" 
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none disabled:bg-blue-400"
          >
            {loading ? "Kirilmoqda..." : "Kirish"}
          </button>
        </form>
      </div>
    </div>
  );
}