"use client";

import { TelegramUsersSection } from "@/components/sales/TelegramUsersSection";

export default function UsersAndTelegramPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <span>👤</span> Xodimlar Boshqaruvi & Telegram Mini App Ulanishi
          </h1>
          <p className="text-xs text-slate-400">
            Xodimlarga alohida rollar berish, 6 xonali OTP ulanish kodlari yaratish va tizimga kirish audit jurnali.
          </p>
        </div>
      </div>

      <TelegramUsersSection />
    </div>
  );
}
