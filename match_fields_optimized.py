import psycopg2
from typing import List, Optional, Tuple

DB_URL = "postgresql://root:EABTqG6h7uy12P9pnswf5rDC34QLU0W8@43.156.48.124:32559/postgres"

def semantic_match(old_code: str, old_name: str, km_records: List[tuple]) -> Optional[Tuple[str, str]]:
    old_code_lower = old_code.lower() if old_code else ""
    old_name_lower = old_name.lower() if old_name else ""

    for km_id, km_typekey, km_typekey_name, km_code, km_name, km_desc in km_records:
        if km_code and old_code_lower == km_code.lower():
            return (km_code, km_desc)

    for km_id, km_typekey, km_typekey_name, km_code, km_name, km_desc in km_records:
        if km_name and old_name_lower == km_name.lower():
            return (km_code, km_desc)

    for km_id, km_typekey, km_typekey_name, km_code, km_name, km_desc in km_records:
        if km_name and old_name_lower and (old_name_lower in km_name.lower() or km_name.lower() in old_name_lower):
            return (km_code, km_desc)

    for km_id, km_typekey, km_typekey_name, km_code, km_name, km_desc in km_records:
        if km_code and old_code_lower and (old_code_lower in km_code.lower() or km_code.lower() in old_code_lower):
            return (km_code, km_desc)

    return None

def check_is_picklist(column_desc: str) -> bool:
    return column_desc and '枚举类型' in column_desc

def process_typekey(conn, cur, typekey: str):
    print(f"\n{'='*60}")
    print(f"Processing: {typekey}")
    print('='*60)

    cur.execute("""
        SELECT id, typekey, typekey_name, column_code, column_name
        FROM api_old
        WHERE typekey = %s
        ORDER BY id
    """, (typekey,))
    old_records = cur.fetchall()
    print(f"api_old records: {len(old_records)}")

    cur.execute("""
        SELECT id, typekey, typekey_name, column_code, column_name, column_desc
        FROM typekey_km
        WHERE typekey = %s
        ORDER BY id
    """, (typekey,))
    km_records = cur.fetchall()
    print(f"typekey_km records: {len(km_records)}")

    if len(km_records) == 0:
        print(f"WARNING: No matching typekey in typekey_km")

    matched_count = 0
    unmatched_count = 0

    for old_record in old_records:
        old_id, typekey, typekey_name, old_column_code, old_column_name = old_record

        match_result = semantic_match(old_column_code, old_column_name, km_records)

        matched_code = None
        column_desc = None
        sa_desc = None
        is_picklist = False

        if match_result:
            matched_code, column_desc = match_result
            sa_desc = column_desc
            is_picklist = check_is_picklist(column_desc)
            matched_count += 1
        else:
            unmatched_count += 1

        cur.execute("SELECT id FROM api_new WHERE typekey = %s AND column_code = %s",
                    (typekey, old_column_code))
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE api_new
                SET typekey_name = %s,
                    column_name = %s,
                    column_desc = %s,
                    sa_desc = %s,
                    is_picklist = %s
                WHERE typekey = %s AND column_code = %s
            """, (typekey_name, old_column_name, column_desc, sa_desc, is_picklist, typekey, old_column_code))
        else:
            cur.execute("""
                INSERT INTO api_new (typekey, typekey_name, column_code, column_name, column_desc, sa_desc, is_picklist)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (typekey, typekey_name, old_column_code, old_column_name, column_desc, sa_desc, is_picklist))

    conn.commit()
    print(f"Result: {matched_count} matched, {unmatched_count} unmatched")

def main():
    print("="*60)
    print("Semantic Matching Process (Optimized)")
    print("="*60)

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("SELECT DISTINCT typekey FROM api_old ORDER BY typekey")
    typekeys = [row[0] for row in cur.fetchall()]
    print(f"\nTotal typekeys: {len(typekeys)}")

    for i, typekey in enumerate(typekeys, 1):
        try:
            print(f"\n[{i}/{len(typekeys)}]", end=" ")
            process_typekey(conn, cur, typekey)
        except Exception as e:
            print(f"\nERROR processing {typekey}: {e}")
            import traceback
            traceback.print_exc()
            conn.rollback()
            continue

    cur.close()
    conn.close()

    print("\n" + "="*60)
    print("Process completed!")
    print("="*60)

if __name__ == "__main__":
    main()
