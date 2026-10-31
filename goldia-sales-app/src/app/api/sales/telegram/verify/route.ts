import { type NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram-auth";
import { supabase } from "@/lib/erp-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { initData, ip, userAgent } = body;

    if (!initData) {
      return NextResponse.json(
        { success: false, error: "initData mavjud emas." },
        { status: 400 }
      );
    }

    const verification = verifyTelegramInitData(initData);
    if (!verification.valid || !verification.user) {
      return NextResponse.json(
        {
          success: false,
          error: verification.error || "Telegram hisobini tasdiqlashda xatolik yuz berdi.",
        },
        { status: 401 }
      );
    }

    const telegramUserId = String(verification.user.id);
    const telegramUsername = verification.user.username || "";

    // Query employee linked to this Telegram user ID
    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, full_name, role, email, organization_id, is_active, phone")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (empErr) {
      return NextResponse.json(
        { success: false, error: "Baza xatoligi: " + empErr.message },
        { status: 500 }
      );
    }

    // If not linked yet
    if (!employee) {
      return NextResponse.json({
        success: true,
        linked: false,
        telegramUser: {
          id: telegramUserId,
          username: telegramUsername,
          firstName: verification.user.first_name,
        },
        message: "Telegram hisobingiz xodim profiliga ulanmagan. Iltimos, 6-xonali kodni kiriting.",
      });
    }

    // If linked but deactivated
    if (employee.is_active === false) {
      // Audit log failed attempt
      await supabase.rpc("rpc_record_login_audit", {
        p_employee_id: employee.id,
        p_email: employee.email,
        p_role: String(employee.role),
        p_login_method: "telegram",
        p_telegram_user_id: telegramUserId,
        p_status: "blocked",
        p_failure_reason: "Foydalanuvchi faol emas (deactivated)",
        p_ip: ip || req.headers.get("x-forwarded-for") || null,
        p_user_agent: userAgent || req.headers.get("user-agent") || null,
      });

      return NextResponse.json(
        {
          success: false,
          error: "Ushbu xodim hisobi faolsizlantirilgan. Rahbariyatga murojaat qiling.",
        },
        { status: 403 }
      );
    }

    // Role-based target routing
    const roleLower = String(employee.role).toLowerCase();
    let redirectUrl = "/sales/app";
    if (roleLower === "seller" || roleLower === "sales") {
      redirectUrl = "/sales/mobile";
    }

    // Record login audit
    await supabase.rpc("rpc_record_login_audit", {
      p_employee_id: employee.id,
      p_email: employee.email,
      p_role: String(employee.role),
      p_login_method: "telegram",
      p_telegram_user_id: telegramUserId,
      p_status: "success",
      p_failure_reason: null,
      p_ip: ip || req.headers.get("x-forwarded-for") || null,
      p_user_agent: userAgent || req.headers.get("user-agent") || null,
    });

    return NextResponse.json({
      success: true,
      linked: true,
      employee: {
        id: employee.id,
        name: employee.full_name,
        role: employee.role,
        email: employee.email,
        organizationId: employee.organization_id,
      },
      redirectUrl,
      telegramUser: {
        id: telegramUserId,
        username: telegramUsername,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "Server xatoligi: " + msg },
      { status: 500 }
    );
  }
}
