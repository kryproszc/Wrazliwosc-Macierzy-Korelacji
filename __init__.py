from numba import njit
import numpy as np

@njit
def calculate_sigma(p_ij, l_ij, w_ij, dev_j):

    n_rows, n_cols = l_ij.shape

    sigmas = np.empty(n_cols)
    sds = np.empty(n_cols)

    for j in range(n_cols):

        dev = dev_j[j]

        num = 0.0
        den = 0.0
        den_sd = 0.0
        cnt = 0

        # Diagnostyka siódmego okresu
        if j == 6:
            print("================================")
            print("DIAGNOSTYKA DLA j = 6")
            print("Development factor:", dev)
            print("================================")

        for i in range(n_rows):

            w = w_ij[i, j]
            p = p_ij[i, j]
            l = l_ij[i, j]

            if not np.isnan(w):

                diff = l - dev

                num += w * p * diff * diff
                den += w
                den_sd += w * p
                cnt += 1

                if j == 6:
                    print(
                        "i =", i,
                        "p =", p,
                        "l =", l,
                        "w =", w,
                        "diff =", diff
                    )

        if den > 1.0 and num > 0:
            sigma = num / (den - 1.0)
        else:
            sigma = 0.0

        sd_val = sigma / den_sd if den_sd > 0.0 else 0.0

        sigmas[j] = sigma
        sds[j] = np.sqrt(sd_val)

        if j == 6:
            print("================================")
            print("PODSUMOWANIE j = 6")
            print("Liczba obserwacji:", cnt)
            print("num:", num)
            print("den:", den)
            print("den_sd:", den_sd)
            print("sigma:", sigma)
            print("sd_val:", sd_val)
            print("sd:", sds[j])
            print("================================")

    return sigmas, sds
