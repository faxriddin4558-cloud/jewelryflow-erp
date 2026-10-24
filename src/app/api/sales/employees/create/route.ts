/* eslint-disable no-console */
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const DEMO_EMAILS_LOWER = [
  "director@goldia.uz",
  "manager@goldia.uz",
  "seller@goldia.uz",
  "dilshod@jewelryflow.uz",
  "jasur@jewelryflow.uz",
  "worker@goldia.uz",
  "accountant@goldia.uz",
  "demo.director@goldia.uz",
  "demo.manager@goldia.uz",
  "demo.seller@goldia.uz",
  "admin@goldia.uz",
];

export async function POST(req: NextRequest) {
  try {
    const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

    // 1. Authenticate caller using session cookies or Authorization Bearer header
    let callerUserId: string | null = null;
    const authHeader = req.headers.get("authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      // Initialize an anon client with token to verify caller
      const { createClient } = await import("@supabase/supabase-js");
      const tempClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );
      const { data: userData, error: userErr } = await tempClient.auth.getUser(token);
      if (!userErr && userData?.user) {
        callerUserId = userData.user.id;
      }
    }

    if (!callerUserId) {
      try {
        const supabaseServer = await createSupabaseServerClient();
        const { data: serverUserData } = await supabaseServer.auth.getUser();
        if (serverUserData?.user) {
          callerUserId = serverUserData.user.id;
        }
      } catch {
        // Ignored, handled below
      }
    }

    if (!callerUserId) {
      return NextResponse.json(
        { success: false, error: "Avtorizatsiyadan o'tilmagan. Iltimos, tizimga qayta kiring." },
        { status: 401 }
      );
    }

    // 2. Verify caller role (MUST be Director / Admin)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient: any = createSupabaseServiceRoleClient();
    const { data: callerEmp, error: callerErr } = await adminClient
      .from("employees")
      .select("id, role, role_type, full_name, email, organization_id")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (callerErr || !callerEmp) {
      return NextResponse.json(
        { success: false, error: "Xodim profili topilmadi." },
        { status: 403 }
      );
    }

    const callerRole = String(callerEmp.role || "").toLowerCase();
    const isDirector = callerRole === "admin" || callerRole === "director" || callerEmp.role_type === "director";

    if (!isDirector) {
      return NextResponse.json(
        { success: false, error: "Xavfsizlik: Faqat korxona Rahbari (Direktor) yangi xodim qo'sha oladi!" },
        { status: 403 }
      );
    }

    const callerOrgId = callerEmp.organization_id;
    if (!callerOrgId) {
      return NextResponse.json(
        { success: false, error: "Xavfsizlik: Boshqaruvchi xodimning tashkiloti (organization_id) aniqlanmadi!" },
        { status: 403 }
      );
    }

    // 3. Parse and validate input
    const body = await req.json();
    const { fullName, email, password, role, phone } = body;

    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      return NextResponse.json({ success: false, error: "Xodim F.I.Sh. kiritilishi shart." }, { status: 400 });
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "To'g'ri email manzil kiritilishi shart." }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();

    if (isProduction && DEMO_EMAILS_LOWER.includes(cleanEmail)) {
      return NextResponse.json(
        { success: false, error: "Production muhitida demo akkaunt ochish taqiqlangan! Haqiqiy xodim xizmat emailidan foydalaning." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { success: false, error: "Parol kamida 6 ta belgidan iborat bo'lishi shart." },
        { status: 400 }
      );
    }

    const allowedRoles = ["Director", "Production Manager", "Seller"];
    if (!allowedRoles.includes(role)) {
      return NextResponse.json(
        { success: false, error: "Noto'g'ri xodim roli tanlandi." },
        { status: 400 }
      );
    }

    const normalizedRole = role === "Director" ? "admin" : role === "Production Manager" ? "production_manager" : "sales";
    const empCode = `EMP-${Date.now().toString().slice(-6)}`;

    // 4. ATOMIC STEP A: Create user in Supabase Auth (Pre-confirmed, no email send rate limit)
    const { data: createdAuth, error: authErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: cleanName,
        role: normalizedRole,
        role_type: role.toLowerCase(),
      },
    });

    if (authErr || !createdAuth?.user) {
      return NextResponse.json(
        { success: false, error: `Auth foydalanuvchisini yaratishda xatolik: ${authErr?.message || "Noma'lum xato"}` },
        { status: 400 }
      );
    }

    const newAuthUserId = createdAuth.user.id;

    // 5. ATOMIC STEP B & C: Database insertion with immediate rollback on error (NO ORPHANED ACCOUNT)
    try {
      // Step B: Insert or update employees row
      const { data: empRecord, error: empErr } = await adminClient
        .from("employees")
        .upsert({
          id: newAuthUserId,
          user_id: newAuthUserId,
          employee_code: empCode,
          name: cleanName,
          full_name: cleanName,
          email: cleanEmail,
          phone: (phone && typeof phone === "string" ? phone.trim() : null),
          role: normalizedRole,
          role_type: role === "Seller" ? "seller" : role.toLowerCase(),
          position: role,
          department: role === "Seller" ? "Savdo" : "Boshqaruv",
          is_active: true,
          organization_id: callerOrgId,
        })
        .select()
        .single();

      if (empErr) {
        throw new Error(`Employees jadvaliga yozishda xatolik: ${empErr.message}`);
      }

      // Step C: If role is Seller, initialize seller_gold_accounts with strictly 0.0000 g
      if (role === "Seller") {
        const { error: sgaErr } = await adminClient.from("seller_gold_accounts").upsert({
          seller_id: newAuthUserId,
          organization_id: callerOrgId,
          total_consigned_gold_grams: 0,
          total_factory_settled_gold_grams: 0,
          current_factory_obligation_grams: 0,
          seller_till_scrap_grams: 0,
          seller_till_scrap_physical_g: 0,
          seller_till_scrap_585_eq_g: 0,
          seller_till_cash_amount: 0,
          seller_till_usd_amount: 0,
          total_client_debt_grams: 0,
          total_transferred_physical_g: 0,
          total_seller_obligation_g: 0,
          total_settled_to_manager_g: 0,
          seller_owes_manager_g: 0,
          manager_owes_seller_g: 0,
          bozor_qarzi_signed_g: 0,
        });

        if (sgaErr) {
          throw new Error(`Sotuvchi hisobini ochishda xatolik: ${sgaErr.message}`);
        }
      }

      // Step D: Record audit trail
      try {
        await adminClient.rpc("rpc_record_login_audit", {
          p_employee_id: callerEmp.id,
          p_email: callerEmp.email || cleanEmail,
          p_role: String(callerEmp.role),
          p_login_method: "employee_provisioning",
          p_telegram_user_id: null,
          p_status: "success",
          p_failure_reason: `Yangi xodim yaratildi: ${cleanName} (${role}, ${cleanEmail})`,
          p_ip: req.headers.get("x-forwarded-for") || null,
          p_user_agent: req.headers.get("user-agent") || null,
        });
      } catch {
        // Non-blocking audit
      }

      return NextResponse.json({
        success: true,
        message: `Yangi xodim muvaffaqiyatli saqlandi: ${cleanName} (${role})!`,
        employee: {
          id: empRecord.id,
          employeeCode: empRecord.employee_code,
          fullName: empRecord.full_name,
          email: empRecord.email,
          role: empRecord.role,
        },
      });
    } catch (dbErr: unknown) {
      // ROLLBACK: Delete newly created Auth user immediately
      const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("DB error occurred during employee creation. Rolling back auth user:", newAuthUserId, errMsg);
      try {
        await adminClient.from("seller_gold_accounts").delete().eq("seller_id", newAuthUserId);
        await adminClient.from("employees").delete().eq("id", newAuthUserId);
        await adminClient.auth.admin.deleteUser(newAuthUserId);
        console.log("Rollback completed: Auth user, profile, and seller account purged (no orphaned account).");
      } catch (rollbackErr) {
        console.error("Failed to clean up auth user during rollback:", rollbackErr);
      }

      return NextResponse.json(
        {
          success: false,
          error: `Baza operatsiyasida xatolik: ${errMsg}. Xavfsizlik ta'minlandi: Auth akkaunt bekor qilindi (yetim akkaunt qolmadi).`,
        },
        { status: 500 }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `Server xatoligi: ${msg}` }, { status: 500 });
  }
}
