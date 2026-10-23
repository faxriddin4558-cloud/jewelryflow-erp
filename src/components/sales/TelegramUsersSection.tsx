"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, type EmployeeRow, type SalesLoginAuditRow } from "@/lib/erp-engine";

export function TelegramUsersSection() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<SalesLoginAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Active OTP Modal
  const [activeOtpModal, setActiveOtpModal] = useState<{
    employeeName: string;
    code: string;
    expiresAt: string;
  } | null>(null);

  // New Employee Modal (For real production onboarding)
  const [newEmpModalOpen, setNewEmpModalOpen] = useState(false);
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpEmail, setNewEmpEmail] = useState("");
  const [newEmpPhone, setNewEmpPhone] = useState("+998 ");
  const [newEmpRole, setNewEmpRole] = useState<"Director" | "Production Manager" | "Seller">("Seller");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, auditRes] = await Promise.all([
        supabase.from("employees").select("*").order("name", { ascending: true }),
        supabase.from("sales_login_audit_logs").select("*, employee:employees(name, full_name)").order("created_at", { ascending: false }).limit(20),
      ]);

      if (empRes.data) {
        setEmployees(empRes.data as EmployeeRow[]);
      }
      if (auditRes.data) {
        setAuditLogs(auditRes.data as SalesLoginAuditRow[]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Ma'lumot yuklashda xatolik: ${msg}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerateOtp = async (emp: EmployeeRow) => {
    if (!emp.id) return;
    setLoading(true);
    setStatusMessage(null);

    try {
      const { data, error } = await supabase.rpc("rpc_generate_telegram_link_code", {
        p_employee_id: emp.id,
      });

      if (error) throw error;

      const res = typeof data === "string" ? JSON.parse(data) : data;
      setActiveOtpModal({
        employeeName: emp.name || emp.full_name || "Xodim",
        code: res.link_code,
        expiresAt: res.expires_at,
      });
      setStatusMessage({
        type: "success",
        text: `${emp.name || emp.full_name} uchun 6 xonali Telegram ulanish kodi yaratildi!`,
      });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Kod yaratishda xatolik: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkTelegram = async (emp: EmployeeRow) => {
    if (!emp.id) return;
    if (!confirm(`${emp.name || emp.full_name}ning Telegram ulanishini bekor qilmoqchimisiz?`)) {
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      const { error } = await supabase.rpc("rpc_unlink_telegram", {
        p_employee_id: emp.id,
      });

      if (error) throw error;

      setStatusMessage({
        type: "success",
        text: `${emp.name || emp.full_name} Telegram hisobidan muvaffaqiyatli uzildi!`,
      });
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Uzishda xatolik: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpEmail.trim()) {
      setStatusMessage({ type: "error", text: "Xodim ismi va emaili kiritilishi shart!" });
      return;
    }
    setLoading(true);
    setStatusMessage(null);
    try {
      const cleanEmail = newEmpEmail.trim().toLowerCase();
      const cleanName = newEmpName.trim();
      const empCode = `EMP-${Date.now().toString().slice(-6)}`;
      const normalizedRole =
        newEmpRole === "Director" ? "admin" : newEmpRole === "Production Manager" ? "production_manager" : "seller";

      const { data: created, error: empErr } = await supabase
        .from("employees")
        .insert({
          employee_code: empCode,
          name: cleanName,
          full_name: cleanName,
          email: cleanEmail,
          phone: newEmpPhone.trim() || null,
          department: newEmpRole === "Seller" ? "Savdo" : "Boshqaruv",
          role: normalizedRole,
          role_type: newEmpRole,
          position: newEmpRole,
          is_active: true,
        })
        .select()
        .single();

      if (empErr) throw empErr;

      if (created && normalizedRole === "seller") {
        await supabase.from("seller_gold_accounts").insert({
          seller_id: created.id,
          organization_id: created.organization_id || "00000000-0000-4001-8001-000000000001",
          total_consigned_gold_grams: 0,
          total_factory_settled_gold_grams: 0,
          current_factory_obligation_grams: 0,
          seller_till_scrap_grams: 0,
          seller_till_cash_amount: 0,
          total_client_debt_grams: 0,
        });
      }

      setStatusMessage({
        type: "success",
        text: `Yangi xodim muvaffaqiyatli saqlandi: ${cleanName} (${newEmpRole})!`,
      });
      setNewEmpModalOpen(false);
      setNewEmpName("");
      setNewEmpEmail("");
      setNewEmpPhone("+998 ");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: "error", text: `Xodimni qo'shishda xatolik: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 text-white rounded-3xl p-6 border-2 border-blue-500/30 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase font-extrabold tracking-widest text-blue-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse"></span>
              Xavfsizlik & Telegram Mini App Boshqaruvi
            </div>
            <h2 className="text-2xl font-black mt-1 text-white">Xodimlar va Telegram Ulanish Markazi</h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl font-medium">
              Har bir xodimga shaxsiy 6 xonali OTP kod beriladi. Xodim Telegram bot (@jewelryflow_sales_bot) yoki Mini App orqali kodni kiritishi bilan hisobi avtomatik bog&apos;lanadi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewEmpModalOpen(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md flex items-center gap-1.5"
            >
              <span>➕</span> Yangi Xodim Qo&apos;shish
            </button>
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition shadow-md flex items-center gap-2"
            >
              <span>🔄</span> Yangilash
            </button>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`px-4 py-3 rounded-2xl border-2 flex items-center justify-between shadow-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span>{statusMessage.type === "success" ? "✅" : "⚠️"}</span>
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="font-bold opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* New Employee Modal */}
      {newEmpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEmployee}
            className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-slate-200 text-slate-900 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <span>👤</span> Yangi Xodimni Ro&apos;yxatdan O&apos;tkazish
              </h3>
              <button
                type="button"
                onClick={() => setNewEmpModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Xodim F.I.Sh.:</label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Abdullayev Tohir"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Xizmat Emaili:</label>
                <input
                  type="email"
                  required
                  placeholder="tohir@goldia.uz"
                  value={newEmpEmail}
                  onChange={(e) => setNewEmpEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Telefon Raqami:</label>
                <input
                  type="text"
                  placeholder="+998 90 123 45 67"
                  value={newEmpPhone}
                  onChange={(e) => setNewEmpPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Tizimdagi Roli:</label>
                <select
                  value={newEmpRole}
                  onChange={(e) => setNewEmpRole(e.target.value as "Director" | "Production Manager" | "Seller")}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="Seller">Sotuvchi (Seller / Savdo xodimi)</option>
                  <option value="Production Manager">Boshqaruvchi (Production Manager / Zavod hisobchisi)</option>
                  <option value="Director">Direktor (Rahbar / To&apos;liq vakolat)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  * Sotuvchi tanlansa, avtomatik ravishda uning shaxsiy bozor qarzi va kassa hisobvarag&apos;i ochiladi.
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setNewEmpModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition disabled:opacity-50"
              >
                {loading ? "Saqlanmoqda..." : "Saqlash"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* OTP Display Modal */}
      {activeOtpModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border-2 border-blue-400 text-center space-y-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
              🔑
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900">Telegram Ulanish Kodi (OTP)</h3>
              <p className="text-xs text-slate-500 mt-1">
                <span className="font-bold text-slate-800">{activeOtpModal.employeeName}</span> ushbu kodni Telegram bot yoki ilovada kiritishi shart:
              </p>
            </div>

            {/* 6 Digit display */}
            <div className="bg-slate-900 text-amber-400 font-mono font-black text-4xl tracking-widest py-4 px-6 rounded-2xl border-2 border-amber-400 shadow-inner">
              {activeOtpModal.code}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span>⏳ Amal qilish muddati: 15 daqiqa</span>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(activeOtpModal.code);
                  alert("Kod nusxalandi: " + activeOtpModal.code);
                }}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition"
              >
                📋 Kodni Nusxalash
              </button>
              <button
                onClick={() => setActiveOtpModal(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employees Table */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <span>👥</span> Xodimlar Ro&apos;yxati va Telegram Holati
          </h3>
          <span className="text-xs text-slate-400 font-mono">{employees.length} xodim</span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-bold">Xodim Ismi</th>
                <th className="py-2.5 px-3 font-bold">Roli</th>
                <th className="py-2.5 px-3 font-bold">Email</th>
                <th className="py-2.5 px-3 font-bold">Telegram Holati</th>
                <th className="py-2.5 px-3 font-bold">Telegram ID / User</th>
                <th className="py-2.5 px-3 font-bold">Faol OTP Kod</th>
                <th className="py-2.5 px-3 font-bold text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((emp) => {
                const isLinked = Boolean(emp.telegram_user_id);
                return (
                  <tr key={emp.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-3 font-bold text-slate-900">{emp.name || emp.full_name || "—"}</td>
                    <td className="py-3 px-3">
                      <span className="bg-slate-100 text-slate-800 font-semibold px-2 py-0.5 rounded-lg text-[11px]">
                        {emp.role || emp.position || "Xodim"}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600">{emp.email || "—"}</td>
                    <td className="py-3 px-3">
                      {isLinked ? (
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-lg text-[11px] flex items-center gap-1 w-fit">
                          <span>✓</span> Bog&apos;langan
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-lg text-[11px] flex items-center gap-1 w-fit">
                          <span>○</span> Bog&apos;lanmagan
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px]">
                      {emp.telegram_username ? (
                        <span className="text-blue-600 font-bold">@{emp.telegram_username}</span>
                      ) : emp.telegram_user_id ? (
                        <span className="text-slate-600">ID: {emp.telegram_user_id}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono">
                      {emp.telegram_link_code ? (
                        <span className="bg-amber-100 text-amber-900 font-black px-2 py-0.5 rounded-lg text-xs">
                          {emp.telegram_link_code}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleGenerateOtp(emp)}
                          disabled={loading}
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-lg transition border border-blue-200"
                        >
                          🔑 OTP Kodi
                        </button>
                        {isLinked && (
                          <button
                            onClick={() => handleUnlinkTelegram(emp)}
                            disabled={loading}
                            className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-lg transition border border-rose-200"
                          >
                            ✕ Uzish
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales Login Audit Trail */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <span>🛡️</span> Savdo Tizimiga Kirish Audit Jurnali (Login Audit Trail)
          </h3>
          <span className="text-xs text-slate-400 font-mono">Oxirgi 20 ta kirish</span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs">Audit yozuvlari mavjud emas</div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-bold">Vaqt</th>
                  <th className="py-2.5 px-3 font-bold">Xodim / Email</th>
                  <th className="py-2.5 px-3 font-bold">Rol</th>
                  <th className="py-2.5 px-3 font-bold">Usul (Method)</th>
                  <th className="py-2.5 px-3 font-bold">Holat</th>
                  <th className="py-2.5 px-3 font-bold">Qurilma / IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                      {new Date(log.created_at).toLocaleString("uz-UZ")}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {log.employee?.name || log.employee?.full_name || log.email || "Anonim"}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="bg-slate-100 text-slate-800 font-semibold px-2 py-0.5 rounded-lg text-[10px]">
                        {log.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                          log.login_method === "telegram"
                            ? "bg-blue-100 text-blue-800"
                            : log.login_method === "password"
                            ? "bg-slate-100 text-slate-800"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {log.login_method}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {log.status === "success" ? (
                        <span className="text-emerald-700 font-bold">✓ Muvaffaqiyatli</span>
                      ) : (
                        <span className="text-rose-600 font-bold">✕ Xato</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px] truncate max-w-[200px]">
                      {log.ip_address || "Lokal"} • {log.user_agent?.slice(0, 30) || "Browser"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
